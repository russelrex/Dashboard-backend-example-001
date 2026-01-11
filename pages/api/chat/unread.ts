import type { NextApiRequest, NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import clientPromise from '../../../lib/mongodb';
import cors from '../../../src/lib/cors';
import type { UnreadCountsResponse, RoomUnreadCount } from '../../../src/types/chat';
import { getDbName } from '../../../src/lib/mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  switch (req.method) {
    case 'GET':
      return getUnreadCounts(req, res);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function getUnreadCounts(req: NextApiRequest, res: NextApiResponse) {
  const { userId } = req.query as { userId: string };
  
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const pipeline = [
      {
        $match: {
          roomId: { $exists: true },
          sender: { $ne: new ObjectId(userId) },
          readBy: { $ne: userId }
        }
      },
      {
        $group: {
          _id: '$roomId',
          unreadCount: { $sum: 1 },
          lastMessageAt: { $max: '$createdAt' },
          lastUnreadMessage: {
            $first: {
              _id: '$_id',
              text: '$text',
              sender: '$sender',
              createdAt: '$createdAt'
            }
          }
        }
      },
      {
        $lookup: {
          from: 'chat_rooms',
          localField: '_id',
          foreignField: 'roomId',
          as: 'roomInfo'
        }
      },
      {
        $match: {
          'roomInfo.0': { $exists: true }
        }
      },
      {
        $project: {
          roomId: '$_id',
          unreadCount: 1,
          lastMessageAt: 1,
          lastUnreadMessage: 1,
          _id: 0
        }
      },
      {
        $sort: { lastMessageAt: -1 }
      }
    ];

    const roomUnreadCounts = await db.collection('chat_messages').aggregate(pipeline).toArray() as RoomUnreadCount[];
    
    const totalUnread = roomUnreadCounts.reduce((sum, room) => sum + room.unreadCount, 0);

    const response: UnreadCountsResponse = {
      totalUnread,
      roomUnreadCounts
    };

    return res.status(200).json({
      success: true,
      data: response
    });

  } catch (error) {
    console.error('[Chat] Error fetching unread counts:', error);
    return res.status(500).json({
      error: 'Failed to fetch unread counts',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
} 