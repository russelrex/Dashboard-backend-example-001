/**
 * File: create.ts
 * Purpose: Create live location tracking session
 * Author: LPai Team
 * Last Modified: 2025-10-08
 * Dependencies: MongoDB, JWT auth
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// Generate short, URL-safe token
function generateTrackingToken(): string {
  // 8 characters, alphanumeric only (no confusing chars like 0/O, 1/l)
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let token = '';
  const bytes = crypto.randomBytes(8);
  
  for (let i = 0; i < 8; i++) {
    token += chars[bytes[i] % chars.length];
  }
  
  return token;
}

// Verify JWT token
function verifyAuth(req: NextApiRequest) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    throw new Error('No token provided');
  }

  try {
    return jwt.verify(token, process.env.JWT_SECRET!) as any;
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
    // Auth check
    const authUser = verifyAuth(req);
    if (!authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      appointmentId,
      locationId,
      contactId,
      estimatedArrival,
      etaMinutes
    } = req.body;

    // Validate required fields
    if (!appointmentId || !locationId || !contactId) {
      return res.status(400).json({ 
        error: 'Missing required fields: appointmentId, locationId, contactId' 
      });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Get appointment details
    const appointment = await db.collection('appointments').findOne({
      _id: new ObjectId(appointmentId),
      locationId
    });

    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    // Get tech (user) details
    const tech = await db.collection('users').findOne({
      _id: new ObjectId(authUser._id)
    });

    if (!tech) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get contact details
    const contact = await db.collection('contacts').findOne({
      _id: new ObjectId(contactId),
      locationId
    });

    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // ✅ CHECK FOR EXISTING TRACKING SESSION FIRST
    const existingSession = await db.collection('tracking_sessions').findOne({
      appointmentId: new ObjectId(appointmentId),
      status: 'active'
    });

    let token: string;
    let expiresAt: Date;
    let isReused = false;

    if (existingSession) {
      // ✅ REUSE EXISTING TOKEN
      token = existingSession.token;
      
      // Extend expiration to 30 min after appointment start
      const appointmentStartTime = new Date(appointment.start);
      expiresAt = new Date(appointmentStartTime.getTime() + 30 * 60 * 1000);
      
      // Update the existing session
      await db.collection('tracking_sessions').updateOne(
        { _id: existingSession._id },
        { 
          $set: { 
            expiresAt,
            updatedAt: new Date()
          } 
        }
      );
      
      isReused = true;
      console.log(`[Tracking] Reusing existing token ${token} for appointment ${appointmentId}`);
      
    } else {
      // ✅ CREATE NEW TOKEN
      token = generateTrackingToken();
      
      const appointmentStartTime = new Date(appointment.start);
      expiresAt = new Date(appointmentStartTime.getTime() + 30 * 60 * 1000);

      const trackingSession = {
        token,
        userId: new ObjectId(authUser._id),
        appointmentId: new ObjectId(appointmentId),
        contactId: new ObjectId(contactId),
        locationId,
        createdAt: new Date(),
        expiresAt,
        status: 'active',
      };

      await db.collection('tracking_sessions').insertOne(trackingSession);
      
      console.log(`[Tracking] Created NEW token ${token} for user ${authUser._id}`);
    }

    return res.status(200).json({
      success: true,
      token,
      url: `https://www.fieldserv.ai/live/${token}`,
      expiresAt,
      isReused, // Tell the frontend if we reused the token
      message: isReused 
        ? 'Using existing tracking link (extended expiration)'
        : 'Customer can track your location for the next 30 minutes'
    });

  } catch (error: any) {
    console.error('[TrackingCreate] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to create tracking session',
      message: error.message 
    });
  }
}
