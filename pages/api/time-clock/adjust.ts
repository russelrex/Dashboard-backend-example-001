// pages/api/time-clock/adjust.ts
import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';

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
      adjustmentType, 
      newClockIn, 
      newClockOut, 
      reason,
      approvedBy 
    } = req.body;

    // Validate required fields
    if (!sessionId || !adjustmentType || !reason) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Get the original session
    const originalSession = await db.collection('clock_sessions').findOne({
      _id: new ObjectId(sessionId)
    });

    if (!originalSession) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check permissions - user can only adjust their own time unless manager
    const isManager = ['manager', 'admin', 'owner'].includes(authUser.role);
    const isOwnSession = originalSession.userId === authUser.userId;

    if (!isManager && !isOwnSession) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Create adjustment record
    const adjustment = {
      _id: new ObjectId(),
      sessionId: new ObjectId(sessionId),
      userId: originalSession.userId,
      locationId: originalSession.locationId,
      adjustmentType,
      original: {
        clockIn: originalSession.clockInTime,
        clockOut: originalSession.clockOutTime,
        totalMiles: originalSession.totalMiles,
        drivingMiles: originalSession.drivingMiles
      },
      adjusted: {
        clockIn: newClockIn ? new Date(newClockIn) : originalSession.clockInTime,
        clockOut: newClockOut ? new Date(newClockOut) : originalSession.clockOutTime,
        totalMiles: originalSession.totalMiles,
        drivingMiles: originalSession.drivingMiles
      },
      reason,
      requestedBy: authUser.userId,
      requestedAt: new Date(),
      status: isManager ? 'approved' : 'pending',
      approvedBy: isManager ? authUser.userId : null,
      approvedAt: isManager ? new Date() : null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Insert adjustment record
    const adjustmentResult = await db.collection('time_adjustments').insertOne(adjustment);

    // If manager or auto-approved, update the session
    if (isManager) {
      const updateData: any = {
        updatedAt: new Date(),
        hasAdjustments: true,
        lastAdjustmentId: adjustment._id
      };

      if (newClockIn) {
        updateData.clockInTime = new Date(newClockIn);
      }

      if (newClockOut) {
        updateData.clockOutTime = new Date(newClockOut);
        updateData.status = 'completed'; // Ensure status is completed if clockOut is set
      }

      // Recalculate duration if times changed
      if (newClockIn || newClockOut) {
        const clockIn = newClockIn ? new Date(newClockIn) : originalSession.clockInTime;
        const clockOut = newClockOut ? new Date(newClockOut) : originalSession.clockOutTime;
        
        if (clockOut) {
          const totalDurationMs = clockOut.getTime() - new Date(clockIn).getTime();
          
          // Calculate break time
          const totalBreakMs = (originalSession.breaks || []).reduce((total: number, breakItem: any) => {
            if (breakItem.endTime) {
              return total + (new Date(breakItem.endTime).getTime() - new Date(breakItem.startTime).getTime());
            }
            return total;
          }, 0);

          const workDurationMs = totalDurationMs - totalBreakMs;
          const workHours = workDurationMs / (1000 * 60 * 60);

          updateData.totalDurationMs = totalDurationMs;
          updateData.workDurationMs = workDurationMs;
          updateData.workHours = workHours;
        }
      }

      await db.collection('clock_sessions').updateOne(
        { _id: new ObjectId(sessionId) },
        { $set: updateData }
      );

      // Update daily summary if needed
      if (newClockIn || newClockOut) {
        const sessionDate = new Date(originalSession.clockInTime);
        sessionDate.setHours(0, 0, 0, 0);

        await db.collection('daily_summaries').updateOne(
          {
            userId: originalSession.userId,
            date: sessionDate,
            locationId: originalSession.locationId
          },
          {
            $set: {
              hasAdjustments: true,
              lastAdjustmentAt: new Date()
            }
          }
        );
      }
    }

    // Log activity
    await db.collection('activity_logs').insertOne({
      _id: new ObjectId(),
      type: 'time_adjustment',
      userId: authUser.userId,
      targetUserId: originalSession.userId,
      sessionId: new ObjectId(sessionId),
      adjustmentId: adjustmentResult.insertedId,
      timestamp: new Date(),
      metadata: {
        adjustmentType,
        reason,
        status: adjustment.status,
        originalTimes: {
          clockIn: originalSession.clockInTime,
          clockOut: originalSession.clockOutTime
        },
        newTimes: {
          clockIn: newClockIn || originalSession.clockInTime,
          clockOut: newClockOut || originalSession.clockOutTime
        }
      }
    });

    // Send notification if pending approval
    if (!isManager) {
      // TODO: Send notification to managers via Ably
      // This would integrate with your notification system
    }

    return res.status(200).json({
      success: true,
      adjustmentId: adjustmentResult.insertedId,
      status: adjustment.status,
      message: isManager 
        ? 'Time adjustment applied successfully' 
        : 'Time adjustment request submitted for approval'
    });

  } catch (error: any) {
    console.error('Time adjustment error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
    });
  }
}