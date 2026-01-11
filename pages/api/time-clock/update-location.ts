// pages/api/time-clock/update-location.ts :

import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import Ably from 'ably';

// Initialize Ably
const ably = new Ably.Rest(process.env.ABLY_API_KEY!);

// Auth middleware - returns null instead of throwing to prevent spam
async function verifyAuth(req: NextApiRequest) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return null; // Silent fail - no error thrown
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    return decoded;
  } catch (error) {
    return null; // Silent fail - no error thrown
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  console.log('🔵 [update-location] Request received');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔵 [update-location] Verifying auth...');
    const authUser = await verifyAuth(req);
    if (!authUser) {
      console.log('❌ [update-location] Auth failed');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    console.log('✅ [update-location] Auth success:', { userId: authUser.userId });

    const { 
      sessionId,
      location,      // ❌ OLD - expects single location
      locations,     // ✅ NEW - batch array
      totalMiles: providedTotalMiles,
      drivingMiles: providedDrivingMiles,
      activity,
      batteryLevel,
      isCharging,
      networkType,
      batchSummary,
      isBatchFallback
    } = req.body;

    console.log('🔍 [update-location] Request type:', locations ? 'BATCH' : 'SINGLE');

    // Validate required fields
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    
    console.log('🔵 [update-location] sessionId:', sessionId);

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Update user's last known location (for tracking)
    if (location?.coords) {
      console.log('🔵 [update-location] Updating user location...');
      await db.collection('users').updateOne(
        { ghlUserId: authUser.userId },
        { 
          $set: { 
            lastLocation: {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              accuracy: location.coords.accuracy
            },
            lastLocationUpdate: new Date()
          } 
        }
      );
      console.log('✅ [update-location] User location updated');
    }

    // Find the active session
    console.log('🔵 [update-location] Finding session...');
    const session = await db.collection('clock_sessions').findOne({
      _id: new ObjectId(sessionId),
      status: 'active'
    });

    if (!session) {
      console.log('❌ [update-location] Session not found:', sessionId);
      return res.status(404).json({ error: 'Active session not found' });
    }
    console.log('✅ [update-location] Session found:', session._id);

    if (locations && Array.isArray(locations)) {
      // BATCH UPDATE MODE
      console.log('📦 [update-location] Processing batch of', locations.length, 'locations');
      
      // ✅ Calculate distance from ALL coordinates received
      let batchDistance = 0;
      let batchDrivingDistance = 0;
      
      // Prepare route points for database
      const newRoutePoints = locations.map(loc => ({
        coords: {
          latitude: loc.latitude,
          longitude: loc.longitude
        },
        timestamp: new Date(loc.timestamp),
        accuracy: loc.accuracy,
        speed: loc.speed,
        activityType: loc.activityType
      }));
      
      // Get last point from session
      let lastPoint = session.routePoints && session.routePoints.length > 0
        ? session.routePoints[session.routePoints.length - 1]
        : null;

      for (const loc of locations) {
        // ✅ FIX 1: Filter by GPS accuracy FIRST
        if (!loc.accuracy || loc.accuracy > 75) {
          console.log(`[update-location] ⚠️ Skipping point - poor accuracy: ${loc.accuracy}m`);
          continue; // Skip this coordinate entirely
        }
        
        if (lastPoint && lastPoint.coords) {
          const distance = calculateDistance(
            lastPoint.coords.latitude,
            lastPoint.coords.longitude,
            loc.latitude,
            loc.longitude
          );
          
          // Calculate speed from GPS data
          const speedMph = loc.speed ? loc.speed * 2.237 : 0;
          
          // ✅ FIX 3: Reject impossible speeds (GPS errors)
          if (speedMph > 100) {
            console.log(`[update-location] ⚠️ Rejecting outlier speed: ${speedMph.toFixed(1)}mph`);
            continue;
          }
          
          // ✅ FIX 2: Stationary Detection
          const isStationary = speedMph < 0.5 && distance < 0.009; // 0.5mph and <50ft
          if (isStationary) {
            console.log(`[update-location] 🅿️ Stationary detected (${speedMph.toFixed(1)}mph, ${(distance * 5280).toFixed(0)}ft) - not counting`);
            // Update lastPoint but don't count distance
            lastPoint = {
              coords: {
                latitude: loc.latitude,
                longitude: loc.longitude
              }
            };
            continue;
          }
          
          // ✅ UPDATED THRESHOLD: Lower for 1-second intervals
          if (distance >= 0.006) { // ~32 feet - captures legitimate movement
            batchDistance += distance;
            
            // Determine if driving based on speed and activity
            const isDriving = loc.activityType === 'automotive' || speedMph > 5;
            
            if (isDriving) {
              batchDrivingDistance += distance;
            }
            
            console.log(`[update-location] ✅ Added ${(distance * 5280).toFixed(0)}ft (${speedMph.toFixed(1)}mph, ${isDriving ? 'driving' : 'not driving'})`);
          } else {
            console.log(`[update-location] ⏭️ Skipped ${(distance * 5280).toFixed(0)}ft - below threshold`);
          }
        }
        
        // Update lastPoint for next iteration
        lastPoint = {
          coords: {
            latitude: loc.latitude,
            longitude: loc.longitude
          }
        };
      }

      console.log(`📏 [update-location] Batch distance: ${batchDistance.toFixed(2)} mi (${batchDrivingDistance.toFixed(2)} driving)`);
      
      // ✅ INCREMENT the session totals (don't replace!)
      const updateData: any = {
        $inc: {
          totalMiles: batchDistance,
          drivingMiles: batchDrivingDistance
        },
        $push: {
          routePoints: {
            $each: newRoutePoints,
            $slice: -1000
          }
        },
        $set: {
          updatedAt: new Date()
        }
      };
      
      console.log('🔍 [update-location] BATCH Update query:', { sessionId: sessionId });
      console.log('🔍 [update-location] BATCH Update data:', JSON.stringify(updateData, null, 2));

      const updatedSession = await db.collection('clock_sessions').findOneAndUpdate(
        { _id: new ObjectId(sessionId) },
        updateData,
        { returnDocument: 'after' }
      );

      console.log('🔍 [update-location] BATCH findOneAndUpdate result:', {
        hasValue: !!updatedSession,
        hasValueProp: !!updatedSession?.value,
        matchedCount: updatedSession?.lastErrorObject?.n,
        updatedExisting: updatedSession?.lastErrorObject?.updatedExisting,
        responseKeys: updatedSession ? Object.keys(updatedSession) : [],
        fullResponse: updatedSession
      });

      // ✅ Check if update succeeded
      if (!updatedSession) {
        console.error('❌ [update-location] Failed to update session - findOneAndUpdate returned null');
        console.error('❌ [update-location] BATCH Debug info:', {
          sessionId,
          updateDataKeys: Object.keys(updateData),
          hasIncrement: !!updateData.$inc,
          hasPush: !!updateData.$push,
          hasSet: !!updateData.$set
        });
        return res.status(500).json({ 
          error: 'Failed to update session',
          sessionId,
          debug: 'findOneAndUpdate returned null - check logs'
        });
      }

      console.log(`✅ [update-location] Updated totals: ${updatedSession.totalMiles.toFixed(2)} mi`);
      
      // Update user lastLocation for customer tracking
      if (locations.length > 0) {
        const latestLocation = locations[locations.length - 1];
        console.log('🔵 [update-location] Updating user lastLocation from batch...');
        
        try {
          await db.collection('users').updateOne(
            { ghlUserId: authUser.userId },
            { 
              $set: { 
                lastLocation: {
                  latitude: latestLocation.latitude,
                  longitude: latestLocation.longitude,
                  accuracy: latestLocation.accuracy
                },
                lastLocationUpdate: new Date()
              } 
            }
          );
          console.log('✅ [update-location] User lastLocation updated for customer tracking');
        } catch (userUpdateError) {
          console.error('⚠️ [update-location] Failed to update user location (non-critical):', userUpdateError);
          // Don't fail the whole request if this fails
        }
      }

      // ✅ REAL-TIME CUSTOMER TRACKING: Publish location updates to active tracking sessions
      if (locations.length > 0) {
        try {
          // Get user details
          const user = await db.collection('users').findOne(
            { ghlUserId: authUser.userId },
            { projection: { _id: 1, firstName: 1, lastName: 1, phone: 1 } }
          );

          if (user) {
            // Find all active, non-expired tracking sessions for this user
            const activeSessions = await db.collection('tracking_sessions').find({
              userId: user._id,
              status: 'active',
              expiresAt: { $gt: new Date() }
            }).toArray();

            console.log(`📡 [update-location] Found ${activeSessions.length} active tracking sessions`);

            // Publish to each tracking channel
            for (const trackingSession of activeSessions) {
              try {
                const channel = ably.channels.get(`tracking:${trackingSession.token}`);
                
                // Get appointment details
                const appointment = await db.collection('appointments').findOne(
                  { _id: trackingSession.appointmentId },
                  { projection: { title: 1, start: 1, address: 1, customLocation: 1 } }
                );

                const latestLocation = locations[locations.length - 1];
                
                // Publish real-time update
                await channel.publish('update', {
                  status: 'active',
                  currentLocation: {
                    latitude: latestLocation.latitude,
                    longitude: latestLocation.longitude,
                    accuracy: latestLocation.accuracy || 0,
                    timestamp: new Date().toISOString()
                  },
                  techInfo: {
                    name: `${user.firstName} ${user.lastName}`,
                    phone: user.phone || ''
                  },
                  appointmentInfo: {
                    title: appointment?.title || '',
                    scheduledTime: appointment?.start || new Date(),
                    address: appointment?.customLocation || appointment?.address || ''
                  }
                });

                console.log(`✅ [update-location] Published realtime update to tracking:${trackingSession.token}`);
              } catch (publishError) {
                console.error(`⚠️ [update-location] Failed to publish to tracking:${trackingSession.token}:`, publishError);
              }
            }
          }
        } catch (trackingError) {
          console.error('⚠️ [update-location] Failed to process tracking sessions (non-critical):', trackingError);
        }
      }

      // Publish real-time update for customer tracking
      if (locations.length > 0) {
        const latestLocation = locations[locations.length - 1];
        try {
          const channel = ably.channels.get(`user:${session.userId}`);
          await channel.publish('location:update', {
            type: 'batch_location_update',
            userId: session.userId,
            sessionId,
            location: {
              latitude: latestLocation.latitude,
              longitude: latestLocation.longitude,
              accuracy: latestLocation.accuracy,
              timestamp: new Date(latestLocation.timestamp)
            },
            totalMiles: updatedSession.totalMiles,
            drivingMiles: updatedSession.drivingMiles,
            status: 'active'
          });
          console.log('📡 [update-location] Published batch location update to Ably');
        } catch (error) {
          console.error('⚠️ [Ably] Failed to publish batch location update:', error);
          // Don't fail the whole request if Ably fails
        }
      }

      // Return the updated session data
      return res.status(200).json({
        success: true,
        sessionId,
        totalMiles: updatedSession.totalMiles,
        drivingMiles: updatedSession.drivingMiles,
        pointsRecorded: updatedSession.routePoints?.length || 0
      });
    }

    // KEEP THE SINGLE UPDATE CODE AS FALLBACK
    console.log('🔵 [update-location] Processing single location update');
    
    // Calculate distance if we have a previous location
    let distanceAdded = 0;
    if (location && session.routePoints && session.routePoints.length > 0) {
      const lastPoint = session.routePoints[session.routePoints.length - 1];
      if (lastPoint.coords) {
        distanceAdded = calculateDistance(
          lastPoint.coords.latitude,
          lastPoint.coords.longitude,
          location.coords.latitude,
          location.coords.longitude
        );
      }
    }
    
    console.log('🔵 [update-location] Distance calculated:', distanceAdded);

    // Prepare route point
    const routePoint = location ? {
      coords: {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy,
        altitude: location.coords.altitude,
        heading: location.coords.heading,
        speed: location.coords.speed
      },
      timestamp: new Date(location.timestamp || Date.now()),
      activityType: activity?.type || 'unknown',
      activity: activity
    } : null;

    // Update session with new location - USE ATOMIC OPERATORS ONLY
    const updateData: any = {
      $set: {
        updatedAt: new Date()
      }
    };

    // Add distance to totals
    if (distanceAdded > 0) {
      updateData.$inc = {
        totalMiles: distanceAdded
      };
      
      // If driving, add to driving miles
      // Speed is in m/s: 2.24 m/s = 5 mph (low speed threshold for driving)
      const speedMph = location.coords.speed ? location.coords.speed * 2.237 : 0;
      if (speedMph > 5 || activity?.type === 'automotive') {
        if (!updateData.$inc) updateData.$inc = {};
        updateData.$inc.drivingMiles = distanceAdded;
      }
    }

    // Add route point
    if (routePoint) {
      updateData.$push = {
        routePoints: {
          $each: [routePoint],
          $slice: -1000 // Keep only last 1000 points
        }
      };
    }

    // Add device info if provided
    if (batteryLevel !== undefined) {
      if (!updateData.$set) updateData.$set = {};
      updateData.$set.lastDeviceInfo = {
        batteryLevel,
        isCharging,
        networkType,
        timestamp: new Date()
      };
    }

    // If this is a batch update, store summary
    if (batchSummary) {
      if (!updateData.$set) updateData.$set = {};
      updateData.$set.lastBatchSummary = {
        ...batchSummary,
        receivedAt: new Date()
      };
    }

    console.log('🔍 [update-location] Update query:', { sessionId: sessionId });
    console.log('🔍 [update-location] Update data:', JSON.stringify(updateData, null, 2));

    const updatedSession = await db.collection('clock_sessions').findOneAndUpdate(
      { _id: new ObjectId(sessionId) },
      updateData,
      { returnDocument: 'after' }
    );

    console.log('🔍 [update-location] findOneAndUpdate result:', {
      hasValue: !!updatedSession,
      hasValueProp: !!updatedSession?.value,
      matchedCount: updatedSession?.lastErrorObject?.n,
      updatedExisting: updatedSession?.lastErrorObject?.updatedExisting
    });

    // ✅ Check if update succeeded
    if (!updatedSession) {
      console.error('❌ [update-location] Failed to update session - findOneAndUpdate returned null');
      console.error('❌ [update-location] Debug info:', {
        sessionId,
        updateDataKeys: Object.keys(updateData),
        hasIncrement: !!updateData.$inc,
        hasPush: !!updateData.$push,
        hasSet: !!updateData.$set
      });
      return res.status(500).json({ 
        error: 'Failed to update session',
        sessionId,
        debug: 'findOneAndUpdate returned null - check logs'
      });
    }

    // REMOVED: Legacy time_clock_sessions update (collection is empty/unused)
    // All location tracking now happens in clock_sessions collection only
    console.log('✅ [update-location] Location update complete');

    // Publish real-time update
    try {
      const channel = ably.channels.get(`user:${session.userId}`);
      await channel.publish('location:update', {
        type: 'single_location_update',
        userId: session.userId,
        sessionId,
        location: location ? {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy,
          timestamp: new Date(location.timestamp || Date.now())
        } : null,
        totalMiles: updatedSession.totalMiles || 0,
        drivingMiles: updatedSession.drivingMiles || 0,
        status: 'active',
        clockInTime: session.clockInTime,
        elapsedSeconds: Math.floor((Date.now() - new Date(session.clockInTime).getTime()) / 1000)
      });
      console.log('📡 [update-location] Published single location update to Ably');
    } catch (error) {
      console.error('⚠️ [Ably] Failed to publish location update:', error);
      // Don't fail the whole request if Ably fails
    }

    return res.status(200).json({
      success: true,
      sessionId: sessionId,
      totalMiles: updatedSession.totalMiles || 0,
      drivingMiles: updatedSession.drivingMiles || 0,
      pointsRecorded: updatedSession.routePoints?.length || 0
    });

  } catch (error: any) {
    console.error('❌ [update-location] ERROR:', {
      message: error.message,
      stack: error.stack,
      sessionId: req.body?.sessionId
    });
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
    });
  }
}

// Helper function to calculate distance between two points in miles
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Radius of the Earth in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;
  return distance;
}