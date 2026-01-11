// pages/api/team/mark-read.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { locationId, userId, channelId } = req.body;

    if (!locationId || !userId || !channelId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Mark all messages in this channel as read for the current user
    const result = await db.collection('team_messages').updateMany(
      {
        channelId: channelId,
        locationId: locationId,
        readBy: { $ne: userId } // Not already read by current user
      },
      {
        $addToSet: { readBy: userId }
      }
    );

    // If it's a DM channel, also update the DM conversation's unread count
    if (channelId.startsWith('dm:')) {
      await db.collection('dm_conversations').updateOne(
        {
          channelId: channelId,
          locationId: locationId
        },
        {
          $set: {
            [`unreadCount.${userId}`]: 0,
            updatedAt: new Date()
          }
        }
      );
    }

    console.log(`✅ Marked ${result.modifiedCount} messages as read for user ${userId} in channel ${channelId}`);

    return res.status(200).json({ 
      success: true, 
      messagesUpdated: result.modifiedCount 
    });

  } catch (error) {
    console.error('[Team Mark Read] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
