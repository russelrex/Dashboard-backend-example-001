// pages/api/time-clock/clock-in.ts
import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import Ably from 'ably';

// Initialize Ably
const ably = new Ably.Rest(process.env.ABLY_API_KEY!);

// Auth middleware - since you're not using NextAuth based on your existing code
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
      userId, 
      locationId, 
      timestamp, 
      location,
      deviceInfo,
      startMileage 
    } = req.body;

    // Validate required fields
    if (!userId || !locationId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get database client FIRST
    const client = await clientPromise;
    const db = client.db(getDbName());

    // THEN check for existing session
    const existingSession = await db.collection('clock_sessions').findOne({
      userId,
      status: 'active'
    });

    if (existingSession) {
      // User is already clocked in - return the existing session
      return res.status(200).json({
        success: true,
        sessionId: existingSession._id,
        session: {
          id: existingSession._id,
          clockInTime: existingSession.clockInTime,
          status: 'active'
        },
        message: 'Already clocked in'
      });
    }

    // Check if user exists and has permission
    // userId here is the GHL user ID
    const user = await db.collection('users').findOne({
      ghlUserId: userId,
      locationId: locationId,
      isActive: true
    });

    if (!user) {
      return res.status(403).json({ error: 'User not found or not active' });
    }

    // Check if already clocked in
    const activeSession = await db.collection('clock_sessions').findOne({
      userId: userId,  // Use GHL ID for sessions
      status: 'active'
    });

    if (activeSession) {
      return res.status(400).json({ 
        error: 'Already clocked in',
        sessionId: activeSession._id,
        clockInTime: activeSession.clockInTime
      });
    }

    // Get location's labor rules for this user
    const laborRules = await db.collection('labor_rules').findOne({
      locationId: locationId,
      effectiveDate: { $lte: new Date() },
      $or: [
        { expiryDate: { $gte: new Date() } },
        { expiryDate: null }
      ]
    });

    // Create new session
    const sessionData = {
      _id: new ObjectId(),
      userId: userId,  // Store GHL user ID
      locationId: locationId,
      clockInTime: new Date(timestamp || Date.now()),
      clockOutTime: null,
      status: 'active',
      // Mileage tracking
      startMileage: startMileage || 0,
      endMileage: null,
      totalMiles: 0,
      drivingMiles: 0,
      // Location tracking
      startLocation: location || null,
      endLocation: null,
      routePoints: location ? [{
        coords: {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy,
          altitude: location.coords.altitude,
          heading: location.coords.heading,
          speed: location.coords.speed
        },
        timestamp: new Date(location.timestamp || Date.now()),
        activityType: location.activity?.type || 'unknown'
      }] : [],
      // Break tracking
      breaks: [],
      onBreak: false,
      currentBreakType: null,
      // Device info
      deviceInfo: deviceInfo || null,
      // ✅ ADD THIS: Track which device this session started on
      deviceId: deviceInfo?.deviceId || `device_${Date.now()}`,
      deviceName: deviceInfo?.deviceName || deviceInfo?.model || 'Unknown Device',
      // Labor rules snapshot (in case rules change)
      appliedRules: laborRules ? {
        ruleId: laborRules._id,
        ruleName: laborRules.ruleName,
        overtimeThreshold: laborRules.rules?.overtime?.weeklyThreshold || 40,
        overtimeMultiplier: laborRules.rules?.overtime?.multiplier || 1.5,
        mileageRate: laborRules.rules?.mileage?.reimbursementRate || 0.655
      } : null,
      // Metadata
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: authUser.userId
    };

    // Insert the session
    const result = await db.collection('clock_sessions').insertOne(sessionData);

    // ✅ ADD THIS: Update user document with current clock status
    await db.collection('users').updateOne(
      { _id: user._id },
      { 
        $set: { 
          'currentClockStatus': {
            isClockedIn: true,
            sessionId: result.insertedId.toString(),
            trackingDeviceId: deviceInfo?.deviceId || `device_${Date.now()}`,
            trackingDeviceName: deviceInfo?.deviceName || deviceInfo?.model || 'Unknown Device',
            clockInTime: new Date(),
            locationId: locationId
          },
          lastActivity: new Date()
        }
      }
    );

    // Log activity
    await db.collection('activity_logs').insertOne({
      _id: new ObjectId(),
      type: 'clock_in',
      userId: userId,
      performedBy: authUser.userId,
      locationId: locationId,
      sessionId: result.insertedId,
      timestamp: new Date(),
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      metadata: { 
        location: location,
        deviceInfo: deviceInfo,
        startMileage: startMileage
      }
    });

    // Update user's last activity
    await db.collection('users').updateOne(
      { _id: user._id },  // Use the MongoDB _id from the found user
      { 
        $set: { 
          lastClockIn: sessionData.clockInTime,
          currentSessionId: result.insertedId,
          lastActivity: new Date()
        } 
      }
    );

    // Publish real-time event via Ably
    try {
      const channel = ably.channels.get(`location:${locationId}`);
      await channel.publish('user:clocked-in', {
        userId: userId,
        userName: `${user.firstName} ${user.lastName}`,
        clockInTime: sessionData.clockInTime,
        location: location
      });
    } catch (ablyError) {
      console.error('Failed to publish Ably event:', ablyError);
      // Don't fail the request if Ably fails
    }

    // ❌ REMOVED: Frontend already publishes this event
    // This was causing false "another device" alerts because deviceId was 'backend'
    // try {
    //   const channel = ably.channels.get(`user:${userId}`);
    //   await channel.publish('timeclock:update', {
    //     type: 'clock_in',
    //     sessionId: result.insertedId.toString(),
    //     session: {
    //       userId,
    //       sessionId: result.insertedId.toString(),
    //       clockInTime: new Date(),
    //       totalMiles: startMileage || 0,
    //       drivingMiles: 0,
    //       status: 'active',
    //       elapsedSeconds: 0,
    //       trackingDeviceId: deviceInfo?.deviceId || `device_${Date.now()}`,
    //       isTrackingDevice: true
    //     },
    //     timestamp: new Date(),
    //     deviceId: deviceInfo?.deviceId || 'backend'  // This was the problem!
    //   });
    //   console.log(`[Ably] Published clock-in event for user ${userId}`);
    // } catch (error) {
    //   console.error('[Ably] Failed to publish clock-in:', error);
    // }

    // ❌ REMOVED: This was also causing false "another device" alerts
    // The frontend should handle publishing clock_status_changed events
    // try {
    //   const userChannel = ably.channels.get(`user:${userId}`);
    //   await userChannel.publish('clock_status_changed', {
    //     type: 'clock_in',
    //     userId,
    //     sessionId: result.insertedId.toString(),
    //     deviceId: deviceInfo?.deviceId || `device_${Date.now()}`,
    //     deviceName: deviceInfo?.deviceName || deviceInfo?.model || 'Unknown Device',
    //     clockInTime: new Date().toISOString(),
    //     locationId: locationId
    //   });
    //   console.log('✅ Published clock-in event to user channel');
    // } catch (ablyError) {
    //   console.error('Failed to publish Ably event:', ablyError);
    //   // Don't fail the request if Ably fails
    // }

    return res.status(200).json({
      success: true,
      sessionId: result.insertedId,
      session: {
        id: result.insertedId,
        clockInTime: sessionData.clockInTime,
        status: 'active',
        startLocation: sessionData.startLocation,
        appliedRules: sessionData.appliedRules
      },
      message: 'Successfully clocked in'
    });

  } catch (error: any) {
    console.error('Clock in error:', error);
    
    // Log error
    try {
      const client = await clientPromise;
      const db = client.db(getDbName());
      await db.collection('error_logs').insertOne({
        type: 'clock_in_error',
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