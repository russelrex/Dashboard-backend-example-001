// pages/api/time-clock/clock-out.ts
import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import Ably from 'ably';

// Initialize Ably
const ably = new Ably.Rest(process.env.ABLY_API_KEY!);

// Auth middleware
async function verifyAuth(req: NextApiRequest) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    throw new Error('No token provided');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    return decoded;
  } catch (error) {
    throw new Error('Invalid token');
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify authentication
    const authUser = await verifyAuth(req);
    if (!authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { 
      sessionId, 
      userId, 
      locationId, 
      timestamp,
      location,
      endMileage,
      notes
    } = req.body;

    // Validate required fields
    if (!sessionId || !userId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate and clean sessionId
    const cleanSessionId = sessionId.toString().trim();
    if (!cleanSessionId || cleanSessionId.length !== 24) {
      console.error('[Clock Out] Invalid sessionId format:', sessionId);
      return res.status(400).json({ 
        error: 'Invalid session ID format',
        received: sessionId,
        length: sessionId?.length 
      });
    }

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Find the active session
    let session;
    try {
      session = await db.collection('clock_sessions').findOne({
        _id: new ObjectId(cleanSessionId),
        userId: userId,
        status: 'active'
      });
    } catch (error: any) {
      console.error('[Clock Out] ObjectId conversion error:', error.message);
      return res.status(400).json({ 
        error: 'Invalid session ID',
        details: error.message
      });
    }

    if (!session) {
      return res.status(404).json({ error: 'Active session not found' });
    }

    // Check if user has any active breaks
    const activeBreak = session.breaks?.find((b: any) => !b.endTime);
    if (activeBreak) {
      return res.status(400).json({ 
        error: 'Cannot clock out while on break. Please end your break first.',
        activeBreak: activeBreak
      });
    }

    // Calculate session duration
    const clockOutTime = new Date(timestamp || Date.now());
    const clockInTime = new Date(session.clockInTime);
    const totalDurationMs = clockOutTime.getTime() - clockInTime.getTime();
    
    // Calculate break time
    const totalBreakMs = (session.breaks || []).reduce((total: number, breakItem: any) => {
      if (breakItem.endTime) {
        return total + (new Date(breakItem.endTime).getTime() - new Date(breakItem.startTime).getTime());
      }
      return total;
    }, 0);

    const workDurationMs = totalDurationMs - totalBreakMs;
    const workHours = workDurationMs / (1000 * 60 * 60);

    // Calculate mileage
    const totalMiles = endMileage && session.startMileage 
      ? Math.max(0, endMileage - session.startMileage)
      : session.totalMiles || 0;

    // Get the last route point to calculate driving miles
    const lastRoutePoint = session.routePoints?.[session.routePoints.length - 1];
    const drivingMiles = session.drivingMiles || 0;

    // Update the session
    const updateResult = await db.collection('clock_sessions').findOneAndUpdate(
      { 
        _id: new ObjectId(cleanSessionId)
      },
      {
        $set: {
          clockOutTime: clockOutTime,
          status: 'completed',
          endMileage: endMileage || session.endMileage,
          totalMiles: totalMiles,
          drivingMiles: drivingMiles,
          endLocation: location || lastRoutePoint || null,
          totalDurationMs: totalDurationMs,
          workDurationMs: workDurationMs,
          breakDurationMs: totalBreakMs,
          workHours: workHours,
          notes: notes || null,
          updatedAt: new Date(),
          completedBy: authUser.userId
        }
      },
      { 
        returnDocument: 'after',
        includeResultMetadata: true
      }
    );

    if (!updateResult.value) {
      return res.status(404).json({ error: 'Failed to update session' });
    }

    const completedSession = updateResult.value;

    // ✅ ADD THIS: Clear user clock status
    await db.collection('users').updateOne(
      { ghlUserId: userId },
      { 
        $set: { 
          'currentClockStatus': {
            isClockedIn: false,
            sessionId: null,
            trackingDeviceId: null,
            trackingDeviceName: null,
            clockInTime: null,
            locationId: null
          },
          lastActivity: new Date()
        }
      }
    );

    // ✅ ADD THIS: Publish real-time clock-out event
    try {
      const userChannel = ably.channels.get(`user:${userId}`);
      await userChannel.publish('clock_status_changed', {
        type: 'clock_out',
        userId,
        sessionId: sessionId,
        clockOutTime: new Date().toISOString()
      });
      console.log('✅ Published clock-out event to user channel');
    } catch (ablyError) {
      console.error('Failed to publish Ably event:', ablyError);
    }

    // Create daily summary record
    const sessionDate = new Date(clockInTime);
    sessionDate.setHours(0, 0, 0, 0);

    await db.collection('daily_summaries').updateOne(
      {
        userId: userId,
        date: sessionDate,
        locationId: locationId
      },
      {
        $inc: {
          totalSessions: 1,
          totalWorkMs: workDurationMs,
          totalBreakMs: totalBreakMs,
          totalMiles: totalMiles,
          drivingMiles: drivingMiles
        },
        $push: {
          sessions: {
            sessionId: new ObjectId(cleanSessionId),
            clockIn: clockInTime,
            clockOut: clockOutTime,
            workHours: workHours,
            miles: totalMiles
          }
        },
        $set: {
          updatedAt: new Date()
        },
        $setOnInsert: {
          userId: userId,
          date: sessionDate,
          locationId: locationId,
          createdAt: new Date()
        }
      },
      { upsert: true }
    );

    // Log activity
    await db.collection('activity_logs').insertOne({
      _id: new ObjectId(),
      type: 'clock_out',
      userId: userId,
      performedBy: authUser.userId,
      locationId: locationId,
      sessionId: new ObjectId(cleanSessionId),
      timestamp: new Date(),
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      metadata: {
        duration: `${Math.floor(workHours)}h ${Math.round((workHours % 1) * 60)}m`,
        totalMiles: totalMiles,
        location: location,
        notes: notes
      }
    });

    // First find the user
    const user = await db.collection('users').findOne({ ghlUserId: userId });

    // Update user's last activity
    await db.collection('users').updateOne(
      { _id: user._id },
      { 
        $set: { 
          lastClockOut: clockOutTime,
          currentSessionId: null,
          lastActivity: new Date()
        },
        $inc: {
          weeklyHours: workHours,
          weeklyMiles: totalMiles
        }
      }
    );

    // Calculate pay based on rules
    let regularPay = 0;
    let overtimePay = 0;
    let mileageReimbursement = 0;

    if (completedSession.appliedRules) {
      const hourlyRate = user?.hourlyRate || 0;
      // Get weekly hours to check for overtime
      const weekStart = new Date(sessionDate);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of week
      weekStart.setHours(0, 0, 0, 0);
      
      const weeklyStats = await db.collection('clock_sessions').aggregate([
        {
          $match: {
            userId: userId,
            clockInTime: { $gte: weekStart },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: null,
            totalHours: { $sum: '$workHours' }
          }
        }
      ]).toArray();

      const weeklyHours = weeklyStats[0]?.totalHours || 0;
      const overtimeThreshold = completedSession.appliedRules.overtimeThreshold || 40;
      
      if (weeklyHours > overtimeThreshold) {
        const regularHoursThisSession = Math.max(0, overtimeThreshold - (weeklyHours - workHours));
        const overtimeHoursThisSession = workHours - regularHoursThisSession;
        
        regularPay = regularHoursThisSession * hourlyRate;
        overtimePay = overtimeHoursThisSession * hourlyRate * (completedSession.appliedRules.overtimeMultiplier || 1.5);
      } else {
        regularPay = workHours * hourlyRate;
      }
      
      mileageReimbursement = totalMiles * (completedSession.appliedRules.mileageRate || 0.655);
    }

    // Format response
    const response = {
      success: true,
      session: {
        id: completedSession._id,
        clockInTime: completedSession.clockInTime,
        clockOutTime: completedSession.clockOutTime,
        duration: {
          total: formatDuration(totalDurationMs),
          work: formatDuration(workDurationMs),
          break: formatDuration(totalBreakMs)
        },
        hours: {
          total: Number((totalDurationMs / (1000 * 60 * 60)).toFixed(2)),
          work: Number(workHours.toFixed(2)),
          break: Number((totalBreakMs / (1000 * 60 * 60)).toFixed(2))
        },
        mileage: {
          total: totalMiles,
          driving: drivingMiles,
          reimbursement: Number(mileageReimbursement.toFixed(2))
        },
        earnings: {
          regular: Number(regularPay.toFixed(2)),
          overtime: Number(overtimePay.toFixed(2)),
          total: Number((regularPay + overtimePay).toFixed(2))
        }
      },
      message: 'Successfully clocked out'
    };

    // Publish real-time event via Ably
    try {
      const channel = ably.channels.get(`location:${locationId}`);
      await channel.publish('user:clocked-out', {
        userId: userId,
        sessionId: sessionId,
        clockOutTime: clockOutTime,
        duration: response.session.duration.work
      });
    } catch (ablyError) {
      console.error('Failed to publish Ably event:', ablyError);
      // Don't fail the request if Ably fails
    }

    // Publish real-time event
    try {
      const channel = ably.channels.get(`user:${userId}`);
      await channel.publish('timeclock:update', {
        type: 'clock_out',
        session: {
          userId,
          sessionId,
          clockInTime: session.clockInTime,
          clockOutTime: new Date(),
          totalMiles: endMileage || session.totalMiles || 0,
          drivingMiles: session.drivingMiles || 0,
          status: 'completed',
          elapsedSeconds: Math.floor(totalDurationMs / 1000)
        },
        timestamp: new Date(),
        deviceId: 'backend'
      });
      console.log(`[Ably] Published clock-out event for user ${userId}`);
    } catch (error) {
      console.error('[Ably] Failed to publish clock-out:', error);
    }

    return res.status(200).json(response);

  } catch (error: any) {
    console.error('Clock out error:', error);
    
    // Log error
    try {
      const client = await clientPromise;
      const db = client.db(getDbName());
      await db.collection('error_logs').insertOne({
        type: 'clock_out_error',
        error: error.message,
        stack: error.stack,
        request: {
          body: req.body,
          headers: req.headers
        },
        timestamp: new Date()
      });
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }

    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
    });
  }
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}