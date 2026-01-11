// pages/api/users/[userId]/onesignal.ts
// This file is used to sync the OneSignal ID with the user ID

import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = req.query;
  const { onesignalId } = req.body;

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Update user with OneSignal ID
    await db.collection('users').updateOne(
      { _id: new ObjectId(userId as string) },
      { 
        $addToSet: { 
          oneSignalIds: {
            playerId: onesignalId,
            deviceType: req.headers['user-agent']?.includes('iPhone') ? 'ios' : 'android',
            lastSeen: new Date()
          }
        }
      }
    );

    // Set External User ID in OneSignal
    // This links the OneSignal Player ID to your user ID
    const response = await fetch(
      `https://onesignal.com/api/v1/players/${onesignalId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${process.env.ONESIGNAL_REST_API_KEY}`
        },
        body: JSON.stringify({
          external_user_id: userId
        })
      }
    );

    if (!response.ok) {
      console.error('Failed to set External User ID in OneSignal');
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('OneSignal sync error:', error);
    return res.status(500).json({ error: 'Failed to sync OneSignal ID' });
  }
}