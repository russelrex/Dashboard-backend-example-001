// pages/api/team/unread-count.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { locationId, userId } = req.query;

    if (!locationId || !userId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Count unread messages for this user across all channels
    const unreadCount = await db.collection('team_messages').countDocuments({
      locationId: locationId as string,
      readBy: { $ne: userId as string }
    });

    // Also get unread counts for DM conversations
    const dmConversations = await db.collection('dm_conversations')
      .find({
        locationId: locationId as string,
        participants: userId as string
      })
      .toArray();

    let totalUnreadCount = unreadCount;
    
    // Add DM unread counts
    for (const conv of dmConversations) {
      if (conv.unreadCount && conv.unreadCount[userId as string]) {
        totalUnreadCount += conv.unreadCount[userId as string];
      }
    }

    console.log(`📊 User ${userId} has ${totalUnreadCount} unread messages in location ${locationId}`);

    return res.status(200).json({ 
      unreadCount: totalUnreadCount,
      breakdown: {
        channelMessages: unreadCount,
        dmMessages: totalUnreadCount - unreadCount
      }
    });

  } catch (error) {
    console.error('[Team Unread Count] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
