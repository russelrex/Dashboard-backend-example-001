// pages/api/team/location-update.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import Ably from 'ably';

let ably: Ably.Rest | null = null;
try {
  if (process.env.ABLY_API_KEY) {
    ably = new Ably.Rest(process.env.ABLY_API_KEY);
  } else {
    console.warn('[Location Update] Ably API key not configured');
  }
} catch (ablyError) {
  console.error('[Location Update] Failed to initialize Ably:', ablyError);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    const client = await clientPromise;
    const db = client.db(getDbName());

    const { 
      latitude, 
      longitude, 
      accuracy, 
      speed, 
      heading, 
      locationId,
      isClockedIn,  // NEW: Track clock-in status
      sessionId,    // NEW: Time clock session ID
      totalMiles,   // NEW: Current miles tracked
      drivingMiles,  // NEW: Driving miles
      userId,  // Add this - frontend is sending it
      userName,  // Add this too
      status,  // And this
      timestamp  // And this
    } = req.body;

    // Use the userId from the body OR from the token
    const actualUserId = userId || decoded.userId;
    console.log('[Location Update] Processing update for user:', actualUserId, 'status:', status, 'isClockedIn:', isClockedIn);

    // Determine the actual status - prioritize explicit status from body
    const actualStatus = status || (isClockedIn ? 'active' : 'offline');
    
    // Build query based on ID format
    let userQuery: any = {};

    // Check if it's a valid MongoDB ObjectId (24 hex chars)
    if (/^[a-fA-F0-9]{24}$/.test(actualUserId)) {
      userQuery = { _id: new ObjectId(actualUserId) };
    } else {
      // For GHL user IDs or other formats
      userQuery = { ghlUserId: actualUserId };
    }

    const updateData = {
      lastLocation: {
        latitude,
        longitude,
        accuracy,
        speed,
        heading,
        timestamp: new Date(),
      },
      lastActivity: new Date(),
      status: actualStatus, // Use the determined status
      isClockedIn: isClockedIn === true || status === 'active', // Handle both ways
      currentSessionId: isClockedIn ? sessionId : null,
      currentMiles: isClockedIn ? { total: totalMiles, driving: drivingMiles } : null,
    };

    console.log('[Location Update] Updating with status:', updateData.status);

    const updateResult = await db.collection('users').updateOne(
      userQuery,
      { $set: updateData }
    );

    if (updateResult.matchedCount === 0) {
      console.error('[Location Update] No user found with query:', userQuery);
      // Try alternative lookup
      const altQuery = { 
        $or: [
          { userId: actualUserId },
          { _id: actualUserId }
        ]
      };
      
      const altResult = await db.collection('users').updateOne(
        altQuery,
        { $set: updateData }
      );
      
      if (altResult.matchedCount === 0) {
        console.error('[Location Update] Still no user found with alt query:', altQuery);
      } else {
        console.log('[Location Update] User found with alt query');
      }
    } else {
      console.log('[Location Update] User location updated successfully');
    }

    // Store location history if status is active or explicitly clocked in
    if ((actualStatus === 'active' || isClockedIn) && sessionId) {
      await db.collection('location_history').insertOne({
        userId: actualUserId,
        sessionId,
        locationId,
        latitude,
        longitude,
        accuracy,
        speed,
        heading,
        timestamp: new Date(),
        totalMiles,
        drivingMiles,
        status: actualStatus,
      });
    }

    // Broadcast to Ably for real-time updates (if configured)
    if (ably) {
      try {
        const channel = ably.channels.get(`location:${locationId}`);
        await channel.publish('location:update', {
          userId: actualUserId,
          userName: userName || decoded.name,
          latitude,
          longitude,
          accuracy,
          speed,
          heading,
          status: actualStatus, // Use actual status
          isClockedIn: isClockedIn === true || actualStatus === 'active',
          totalMiles,
          drivingMiles,
          timestamp: new Date(),
        });
      } catch (ablyError) {
        console.error('[Location Update] Ably publish failed:', ablyError);
        // Don't fail the entire request if Ably fails
      }
    }

    // Also update team chat presence
    if (ably) {
      try {
        const chatChannel = ably.channels.get(`chat:${locationId}:presence`);
        await chatChannel.publish('presence:update', {
          userId: actualUserId,
          status: actualStatus === 'active' ? 'online' : 'offline',
          isClockedIn: isClockedIn === true || actualStatus === 'active',
        });
      } catch (ablyError) {
        console.error('[Location Update] Ably chat presence failed:', ablyError);
      }
    }

    // Return the actual status that was set
    return res.status(200).json({ 
      success: true,
      status: actualStatus // Return the actual status
    });
  } catch (error: any) {
    console.error('[Location Update] Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code
    });
    
    // Check for specific error types
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    if (error.name === 'MongoError' || error.name === 'MongoServerError') {
      return res.status(500).json({ error: 'Database error', details: error.message });
    }
    
    return res.status(500).json({ 
      error: 'Failed to update location',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
