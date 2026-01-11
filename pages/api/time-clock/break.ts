// pages/api/time-clock/break.ts
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

    const { action, sessionId, breakType = 'break' } = req.body;
    // breakType can be: 'break', 'lunch', 'personal'

    if (!action || !sessionId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Get active session
    const activeSession = await db.collection('clock_sessions').findOne({
      _id: new ObjectId(sessionId),
      status: 'active'
    });

    if (!activeSession) {
      return res.status(404).json({ error: 'Active session not found' });
    }

    // Verify user owns this session
    if (activeSession.userId !== authUser.userId) {
      return res.status(403).json({ error: 'Unauthorized to modify this session' });
    }

    if (action === 'start') {
      // Check if already on break
      const activeBreak = activeSession.breaks?.find((b: any) => !b.endTime);
      if (activeBreak) {
        return res.status(400).json({ 
          error: 'Already on break',
          currentBreak: activeBreak 
        });
      }

      // Start break
      const breakData = {
        id: new ObjectId(),
        type: breakType,
        startTime: new Date(),
        endTime: null,
        duration: null
      };

      await db.collection('clock_sessions').updateOne(
        { _id: new ObjectId(sessionId) },
        {
          $push: { breaks: breakData },
          $set: { 
            onBreak: true,
            currentBreakType: breakType,
            updatedAt: new Date()
          }
        }
      );

      // Log activity
      await db.collection('activity_logs').insertOne({
        _id: new ObjectId(),
        type: 'break_start',
        userId: authUser.userId,
        sessionId: new ObjectId(sessionId),
        locationId: activeSession.locationId,
        timestamp: new Date(),
        metadata: { breakType }
      });

      // Get user info for real-time update
      const user = await db.collection('users').findOne({ _id: new ObjectId(authUser._id) });

      // Publish real-time event via Ably
      try {
        const channel = ably.channels.get(`location:${activeSession.locationId}`);
        await channel.publish('break:started', {
          userId: authUser.userId,
          userName: user ? `${user.firstName} ${user.lastName}` : 'Unknown',
          sessionId: sessionId,
          breakType: breakType,
          startTime: breakData.startTime
        });
      } catch (ablyError) {
        console.error('Failed to publish Ably event:', ablyError);
      }

      return res.status(200).json({
        success: true,
        message: `${breakType} started`,
        break: breakData
      });

    } else if (action === 'end') {
      // Find active break
      const activeBreak = activeSession.breaks?.find((b: any) => !b.endTime);
      if (!activeBreak) {
        return res.status(400).json({ error: 'No active break found' });
      }

      // Calculate duration
      const endTime = new Date();
      const duration = endTime.getTime() - new Date(activeBreak.startTime).getTime();

      // Update break with end time
      await db.collection('clock_sessions').updateOne(
        { 
          _id: new ObjectId(sessionId),
          'breaks.id': activeBreak.id 
        },
        {
          $set: {
            'breaks.$.endTime': endTime,
            'breaks.$.duration': duration,
            onBreak: false,
            currentBreakType: null,
            updatedAt: new Date()
          }
        }
      );

      // Log activity
      await db.collection('activity_logs').insertOne({
        _id: new ObjectId(),
        type: 'break_end',
        userId: authUser.userId,
        sessionId: new ObjectId(sessionId),
        locationId: activeSession.locationId,
        timestamp: new Date(),
        metadata: { 
          breakType: activeBreak.type,
          duration: Math.round(duration / 1000 / 60) // minutes
        }
      });

      // Get user info for real-time update
      const user = await db.collection('users').findOne({ _id: new ObjectId(authUser._id) });

      // Publish real-time event via Ably
      try {
        const channel = ably.channels.get(`location:${activeSession.locationId}`);
        await channel.publish('break:ended', {
          userId: authUser.userId,
          userName: user ? `${user.firstName} ${user.lastName}` : 'Unknown',
          sessionId: sessionId,
          breakType: activeBreak.type,
          endTime: endTime,
          durationMinutes: Math.round(duration / 1000 / 60)
        });
      } catch (ablyError) {
        console.error('Failed to publish Ably event:', ablyError);
      }

      return res.status(200).json({
        success: true,
        message: `${activeBreak.type} ended`,
        break: {
          ...activeBreak,
          endTime,
          duration,
          durationMinutes: Math.round(duration / 1000 / 60)
        }
      });

    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

  } catch (error: any) {
    console.error('Break tracking error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
    });
  }
}