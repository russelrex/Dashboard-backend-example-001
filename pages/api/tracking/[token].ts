/**
 * File: [token].ts
 * Purpose: Customer tracking page - Returns live location data
 * Author: LPai Team
 * Last Modified: 2025-10-13
 * Dependencies: Reads live location from user's clock-in session
 */
import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb'; // ✅ FIXED: Added /src/
import { ObjectId } from 'mongodb';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // ✅ ADD CORS HEADERS
  res.setHeader('Access-Control-Allow-Origin', '*'); // Or 'https://fieldserv.ai'
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Invalid token' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Find the tracking session (view token)
    const trackingSession = await db.collection('tracking_sessions').findOne({ token });

    if (!trackingSession) {
      return res.status(404).json({ error: 'Tracking session not found' });
    }

    // Check if expired
    const now = new Date();
    if (now > new Date(trackingSession.expiresAt)) {
      await db.collection('tracking_sessions').updateOne(
        { token },
        { $set: { status: 'expired' } }
      );
      
      return res.status(410).json({ 
        error: 'Tracking session has expired',
        expired: true 
      });
    }

    // ✅ READ LIVE LOCATION from user's active clock-in session
    const user = await db.collection('users').findOne(
      { _id: trackingSession.userId },
      { 
        projection: { 
          lastLocation: 1,
          lastLocationUpdate: 1,
          isClockedIn: 1,
          firstName: 1,
          lastName: 1,
          phone: 1,
          profilePicture: 1
        } 
      }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get appointment details
    const appointment = await db.collection('appointments').findOne(
      { _id: trackingSession.appointmentId },
      { projection: { title: 1, start: 1, address: 1, customLocation: 1, latitude: 1, longitude: 1 } }
    );

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    // Get location info
    const location = await db.collection('locations').findOne(
      { _id: trackingSession.locationId },
      { projection: { name: 1 } }
    );

    // Calculate ETA if we have both locations
    let etaMinutes = 0;
    let distanceToDestination = null;
    
    if (appointment?.latitude && appointment?.longitude && user.lastLocation) {
      const distance = calculateDistance(
        user.lastLocation.latitude,
        user.lastLocation.longitude,
        appointment.latitude,
        appointment.longitude
      );
      
      distanceToDestination = distance;
      // Rough ETA: 30 mph average = 0.5 miles per minute
      etaMinutes = Math.round(distance / 0.5);
    }

    // ✅ RETURN CORRECT FORMAT FOR FRONTEND
    return res.status(200).json({
      status: user.isClockedIn ? 'active' : 'inactive',
      currentLocation: user.lastLocation ? {
        latitude: user.lastLocation.latitude,
        longitude: user.lastLocation.longitude,
        accuracy: user.lastLocation.accuracy || 0,
        timestamp: user.lastLocationUpdate?.toISOString() || new Date().toISOString()
      } : null,
      techInfo: {
        name: `${user.firstName} ${user.lastName}`,
        phone: user.phone || '',
        photoUrl: user.profilePicture || null
      },
      locationInfo: {
        name: location?.name || 'FieldServ.ai'
      },
      appointmentInfo: {
        title: appointment.title,
        scheduledTime: appointment.start,
        address: appointment.customLocation || appointment.address
      },
      etaMinutes: etaMinutes,
      expiresAt: trackingSession.expiresAt
    });

  } catch (error) {
    console.error('[Tracking] Error fetching location:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}