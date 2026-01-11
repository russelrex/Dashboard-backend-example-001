// pages/api/location/update.ts
import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import Ably from 'ably';

// Initialize Ably
const ably = new Ably.Rest(process.env.ABLY_API_KEY!);

// Helper to calculate distance between two coordinates (in miles)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Radius of the Earth in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

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
      location,
      activity,
      batteryLevel,
      isCharging,
      networkType,
      // New fields for batch updates
      batchSummary,
      isBatchFallback
    } = req.body;

    if (!sessionId || !location) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate location data
    if (!location.coords || typeof location.coords.latitude !== 'number' || typeof location.coords.longitude !== 'number') {
      return res.status(400).json({ error: 'Invalid location data' });
    }

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Get the active session
    const session = await db.collection('clock_sessions').findOne({
      _id: new ObjectId(sessionId),
      status: 'active'
    });

    if (!session) {
      return res.status(404).json({ error: 'Active session not found' });
    }

    // Don't update location if on break (optional - depends on your requirements)
    if (session.onBreak) {
      return res.status(200).json({ 
        success: true, 
        message: 'Location not tracked during break',
        onBreak: true 
      });
    }

    // Get the last location update
    const lastPoint = session.routePoints?.[session.routePoints.length - 1];
    
    // Calculate distance from last point
    let distanceFromLast = 0;
    let isDriving = false;
    
    if (lastPoint && lastPoint.coords) {
      distanceFromLast = calculateDistance(
        lastPoint.coords.latitude,
        lastPoint.coords.longitude,
        location.coords.latitude,
        location.coords.longitude
      );
      
      // Determine if driving based on speed and activity
      const speedMph = location.coords.speed ? location.coords.speed * 2.237 : 0; // Convert m/s to mph
      isDriving = (
        activity?.type === 'in_vehicle' || 
        activity?.type === 'automotive' ||
        speedMph > 15 // Threshold for driving
      );
    }

    // Create location point
    const locationPoint = {
      coords: {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy,
        altitude: location.coords.altitude,
        heading: location.coords.heading,
        speed: location.coords.speed
      },
      timestamp: new Date(location.timestamp || Date.now()),
      activity: activity || { type: 'unknown', confidence: 0 },
      distanceFromLast: distanceFromLast,
      isDriving: isDriving,
      batteryLevel: batteryLevel,
      isCharging: isCharging,
      networkType: networkType
    };

    // Update session with new location and mileage
    const updateData: any = {
      $push: {
        routePoints: {
          $each: [locationPoint],
          $slice: -1000 // Keep only last 1000 points
        }
      },
      $set: {
        lastLocationUpdate: new Date(),
        lastKnownLocation: locationPoint.coords,
        updatedAt: new Date()
      }
    };

    // Handle batch summary updates
    if (isBatchFallback && batchSummary) {
      console.log('Processing batch summary update:', batchSummary);
      
      // Use the accumulated mileage from the mobile app
      updateData.$set.totalMiles = batchSummary.totalMiles;
      updateData.$set.drivingMiles = batchSummary.drivingMiles;
      updateData.$set.endMileage = batchSummary.totalMiles; // Update endMileage too
      
      // Add metadata about the batch
      updateData.$set.lastBatchUpdate = {
        pointCount: batchSummary.pointCount,
        timespan: batchSummary.timespan,
        processedAt: new Date()
      };
    } else {
      // Original logic for single updates
      // Update mileage if we have movement
      if (distanceFromLast > 0.01) { // Minimum distance threshold (0.01 miles = ~53 feet)
        updateData.$inc = {
          totalMiles: distanceFromLast
        };
        
        if (isDriving) {
          updateData.$inc.drivingMiles = distanceFromLast;
        }
      }
    }

    const updateResult = await db.collection('clock_sessions').updateOne(
      { _id: new ObjectId(sessionId) },
      updateData
    );

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Store in location_updates collection for real-time tracking
    // This collection can have a TTL index to auto-delete old entries
    await db.collection('location_updates').insertOne({
      _id: new ObjectId(),
      sessionId: new ObjectId(sessionId),
      userId: session.userId,
      locationId: session.locationId,
      location: locationPoint,
      timestamp: new Date(),
      isBatch: isBatchFallback || false,
      batchSummary: batchSummary || null,
      // TTL: Auto-delete after 24 hours
      expireAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });

    // Create indexes if they don't exist (this should really be done once during setup)
    await db.collection('location_updates').createIndex(
      { expireAt: 1 },
      { expireAfterSeconds: 0 }
    );
    await db.collection('location_updates').createIndex(
      { sessionId: 1, timestamp: -1 }
    );

    // Get updated totals
    const updatedSession = await db.collection('clock_sessions').findOne(
      { _id: new ObjectId(sessionId) },
      { projection: { totalMiles: 1, drivingMiles: 1, endMileage: 1 } }
    );

    // Check for geofence events (if you have job sites configured)
    // This is optional - you'd need a job_sites collection with coordinates
    const jobSites = await db.collection('appointments').find({
      assignedUserId: session.userId,
      start: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0)),
        $lte: new Date(new Date().setHours(23, 59, 59, 999))
      },
      'address.coordinates': { $exists: true }
    }).toArray();

    let nearJobSite = null;
    for (const job of jobSites) {
      if (job.address?.coordinates) {
        const distance = calculateDistance(
          location.coords.latitude,
          location.coords.longitude,
          job.address.coordinates.lat,
          job.address.coordinates.lng
        );
        
        if (distance < 0.1) { // Within 0.1 miles (~528 feet)
          nearJobSite = {
            jobId: job._id,
            customerName: job.contactName,
            distance: distance
          };
          break;
        }
      }
    }

    // Publish real-time event via Ably
    try {
      const channel = ably.channels.get(`location:${session.locationId}`);
      await channel.publish('location:update', {
        userId: session.userId,
        sessionId: sessionId,
        location: locationPoint.coords,
        activity: locationPoint.activity,
        totalMiles: updatedSession?.totalMiles || 0,
        drivingMiles: updatedSession?.drivingMiles || 0,
        nearJobSite: nearJobSite,
        timestamp: locationPoint.timestamp,
        isBatch: isBatchFallback || false
      });
    } catch (ablyError) {
      console.error('Failed to publish Ably event:', ablyError);
      // Don't fail the request if Ably fails
    }

    return res.status(200).json({
      success: true,
      mileage: {
        total: Number((updatedSession?.totalMiles || 0).toFixed(2)),
        driving: Number((updatedSession?.drivingMiles || 0).toFixed(2)),
        lastSegment: Number(distanceFromLast.toFixed(3))
      },
      activity: {
        type: locationPoint.activity.type,
        isDriving: isDriving
      },
      nearJobSite: nearJobSite,
      batchProcessed: isBatchFallback || false,
      message: 'Location updated successfully'
    });

  } catch (error: any) {
    console.error('Location update error:', error);
    
    // Don't log every location error (too noisy), but log critical ones
    if (error.message !== 'Active session not found') {
      try {
        const client = await clientPromise;
        const db = client.db(getDbName());
        await db.collection('error_logs').insertOne({
          type: 'location_update_error',
          error: error.message,
          sessionId: req.body.sessionId,
          timestamp: new Date(),
          stack: error.stack
        });
      } catch (logError) {
        console.error('Failed to log error:', logError);
      }
    }

    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
    });
  }
}