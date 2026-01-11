/**
 * File: status.ts
 * Purpose: Receives call status updates from GHL webhooks
 * Author: LPai Team
 * Last Modified: 2025-01-09
 * Dependencies: MongoDB, Ably
 */

import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import ably from '@/lib/ably-server';
import { getDbName } from '@/lib/mongodb';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await clientPromise;
  const db = client.db(getDbName());

  try {
    const {
      callId,
      status,
      duration,
      recordingUrl,
      errorMessage,
      ghlCallId
    } = req.body;

    if (!callId || !status) {
      return res.status(400).json({ error: 'Missing callId or status' });
    }

    // Get existing call record
    const call = await db.collection('calls').findOne({
      _id: new ObjectId(callId)
    });

    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }

    // Update call status
    const updateData: any = {
      status,
      updatedAt: new Date()
    };

    if (ghlCallId) updateData.ghlCallId = ghlCallId;
    if (duration) updateData.duration = duration;
    if (recordingUrl) updateData.recordingUrl = recordingUrl;
    if (errorMessage) updateData.errorMessage = errorMessage;
    
    if (status === 'completed' || status === 'failed') {
      updateData.endedAt = new Date();
    }

    await db.collection('calls').updateOne(
      { _id: new ObjectId(callId) },
      { $set: updateData }
    );

    // Publish real-time status update
    await ably.channels.get(`user:${call.userId}`).publish('call:status', {
      callId,
      status,
      duration,
      timestamp: new Date().toISOString()
    });

    // Create activity log
    await db.collection('activities').insertOne({
      _id: new ObjectId(),
      locationId: call.locationId,
      contactId: call.contactId,
      userId: call.userId,
      type: 'call',
      action: status === 'completed' ? 'call_completed' : `call_${status}`,
      data: {
        callId,
        duration,
        status
      },
      createdAt: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Call status updated'
    });

  } catch (error: any) {
    console.error('[Call] Error updating status:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update call status'
    });
  }
}