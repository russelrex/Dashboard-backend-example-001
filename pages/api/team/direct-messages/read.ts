// pages/api/team/direct-messages/read.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { locationId, userId, otherUserId } = req.body;

    if (!locationId || !userId || !otherUserId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Create consistent DM channel ID
    const participants = [userId, otherUserId].sort();
    const dmChannelId = `dm:${participants.join(':')}`;

    // Mark all messages in this DM channel as read for the current user
    const result = await db.collection('team_messages').updateMany(
      {
        channelId: dmChannelId,
        locationId: locationId,
        userId: { $ne: userId }, // Messages from other user
        readBy: { $ne: userId } // Not already read by current user
      },
      {
        $addToSet: { readBy: userId }
      }
    );

    // Update the DM conversation's unread count
    await db.collection('dm_conversations').updateOne(
      {
        channelId: dmChannelId,
        locationId: locationId
      },
      {
        $set: {
          [`unreadCount.${userId}`]: 0,
          updatedAt: new Date()
        }
      }
    );

    console.log(`✅ Marked ${result.modifiedCount} DM messages as read for user ${userId}`);

    return res.status(200).json({ 
      success: true, 
      messagesUpdated: result.modifiedCount 
    });

  } catch (error) {
    console.error('[DM Read] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
