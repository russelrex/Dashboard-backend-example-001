/**
 * File: initiate.ts
 * Purpose: Initiates phone calls through GHL workflow webhook
 * Author: LPai Team
 * Last Modified: 2025-01-09
 * Dependencies: MongoDB, GHL API, Ably
 */

import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '@/lib/mongodb';
import cors from '@/lib/cors';
import { ObjectId } from 'mongodb';
import axios from 'axios';
import { getAuthHeader } from '@/utils/ghlAuth';
import ably from '@/lib/ably-server';
import { getDbName } from '@/lib/mongodb';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  await cors(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await clientPromise;
  const db = client.db(getDbName());

  try {
    const {
      contactId,
      locationId,
      userId,
      callType = 'outbound',
      webhookUrl, // The GHL workflow webhook URL
      userPhone, // The user's phone number to call first
      notes
    } = req.body;

    // Validate required fields
    if (!contactId || !locationId || !userId || !webhookUrl) {
      return res.status(400).json({ 
        error: 'Missing required fields: contactId, locationId, userId, webhookUrl' 
      });
    }

    // Get contact details
    const contact = await db.collection('contacts').findOne({
      _id: new ObjectId(contactId),
      locationId
    });

    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Get user details
    const user = await db.collection('users').findOne({
      _id: new ObjectId(userId)
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get location settings for phone configuration
    const location = await db.collection('locations').findOne({
      _id: new ObjectId(locationId)
    });

    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    // Create call record in database
    const callRecord = {
      _id: new ObjectId(),
      locationId,
      contactId: contact._id,
      userId: user._id,
      type: callType,
      status: 'initiating',
      direction: 'outbound',
      fromNumber: userPhone || user.phone,
      toNumber: contact.phone,
      webhookUrl,
      notes,
      startedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('calls').insertOne(callRecord);

    // Trigger the GHL workflow webhook
    // The workflow should be configured to:
    // 1. Call the user's phone first
    // 2. Once user answers, dial the contact
    // 3. Bridge the two calls together
    const webhookPayload = {
      callId: callRecord._id.toString(),
      locationId,
      userPhone: userPhone || user.phone,
      userName: `${user.firstName} ${user.lastName}`,
      contactPhone: contact.phone,
      contactName: `${contact.firstName} ${contact.lastName}`,
      contactId: contact._id.toString(),
      userId: user._id.toString(),
      callbackUrl: `${process.env.NEXT_PUBLIC_API_URL}/api/calls/status`, // For status updates
      notes
    };

    console.log('[Call] Triggering GHL workflow webhook:', webhookUrl);
    
    // Send webhook to GHL workflow
    const webhookResponse = await axios.post(webhookUrl, webhookPayload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    // Update call record with webhook response
    await db.collection('calls').updateOne(
      { _id: callRecord._id },
      {
        $set: {
          status: 'webhook_sent',
          webhookResponse: webhookResponse.data,
          updatedAt: new Date()
        }
      }
    );

    // Publish real-time event for UI updates
    await ably.channels.get(`user:${userId}`).publish('call:initiated', {
      callId: callRecord._id.toString(),
      contactId,
      contactName: `${contact.firstName} ${contact.lastName}`,
      status: 'connecting',
      timestamp: new Date().toISOString()
    });

    // Also publish to location channel for monitoring
    await ably.channels.get(`location:${locationId}`).publish('call:activity', {
      callId: callRecord._id.toString(),
      userId,
      userName: `${user.firstName} ${user.lastName}`,
      contactName: `${contact.firstName} ${contact.lastName}`,
      action: 'initiated',
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      callId: callRecord._id.toString(),
      message: 'Call initiated. Your phone will ring shortly.',
      webhookResponse: webhookResponse.data
    });

  } catch (error: any) {
    console.error('[Call] Error initiating call:', error);
    
    // Publish error event
    if (req.body.userId) {
      await ably.channels.get(`user:${req.body.userId}`).publish('call:error', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to initiate call'
    });
  }
}