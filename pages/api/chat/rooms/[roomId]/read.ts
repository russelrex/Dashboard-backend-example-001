import type { NextApiRequest, NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import clientPromise from '../../../../../lib/mongodb';
import { getDbName } from '../../../../../src/lib/mongodb';
import cors from '../../../../../src/lib/cors';
import type { MarkAsReadRequest } from '../../../../../src/types/chat';
import { realtimeService } from '../../../../../src/services/realtimeService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  switch (req.method) {
    case 'POST':
      return markAsRead(req, res);
    case 'GET':
      return getReadStatus(req, res);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function markAsRead(req: NextApiRequest, res: NextApiResponse) {
  const { roomId, userId } = req.query as { roomId: string; userId: string };
  
  if (!roomId || !userId) {
    return res.status(400).json({ error: 'roomId and userId are required' });
  }

  try {
    const { messageIds, markAllAsRead, upToMessageId } = req.body as MarkAsReadRequest;
    
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const room = await db.collection('chat_rooms').findOne({ roomId });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    let updateFilter: any = { roomId };

    if (markAllAsRead) {
      updateFilter.sender = { $ne: new ObjectId(userId) };
      updateFilter.readBy = { $ne: userId };
    } else if (upToMessageId) {
      const upToMessage = await db.collection('chat_messages').findOne(
        { _id: new ObjectId(upToMessageId), roomId }
      );
      
      if (!upToMessage) {
        return res.status(404).json({ error: 'Reference message not found' });
      }

      updateFilter.sender = { $ne: new ObjectId(userId) };
      updateFilter.createdAt = { $lte: upToMessage.createdAt };
      updateFilter.readBy = { $ne: userId };
    } else if (messageIds && messageIds.length > 0) {
      updateFilter._id = { $in: messageIds.map(id => new ObjectId(id)) };
      updateFilter.sender = { $ne: new ObjectId(userId) };
      updateFilter.readBy = { $ne: userId };
    } else {
      return res.status(400).json({ error: 'Must specify messageIds, markAllAsRead, or upToMessageId' });
    }

    const result = await db.collection('chat_messages').updateMany(
      updateFilter,
      { $addToSet: { readBy: userId } }
    );

    const markedCount = result.modifiedCount;

    if (markedCount > 0) {
      try {
        await realtimeService.publishMessagesRead(
          roomId, 
          userId, 
          [], 
          new Date()
        );
      } catch (realtimeError) {
        console.error('[Chat] Failed to publish read status update:', realtimeError);
      }
    }

    return res.status(200).json({
      success: true,
      message: `${markedCount} messages marked as read`,
      markedCount
    });

  } catch (error) {
    console.error('[Chat] Error marking messages as read:', error);
    return res.status(500).json({
      error: 'Failed to mark messages as read',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

async function getReadStatus(req: NextApiRequest, res: NextApiResponse) {
  const { roomId, userId } = req.query as { roomId: string; userId: string };
  const { messageIds } = req.query;
  
  if (!roomId || !userId) {
    return res.status(400).json({ error: 'roomId and userId are required' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    let query: any = { roomId };
    
    if (messageIds) {
      const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
      query._id = { $in: ids.map(id => new ObjectId(id)) };
    }

    const messages = await db.collection('chat_messages').find(
      query,
      { 
        projection: { 
          _id: 1, 
          roomId: 1, 
          readBy: 1,
          createdAt: 1
        } 
      }
    ).toArray();

    const readStatuses = messages.map(msg => ({
      messageId: msg._id.toString(),
      userId,
      roomId,
      isRead: msg.readBy.includes(userId),
      readAt: msg.readBy.includes(userId) ? msg.createdAt : null
    }));

    return res.status(200).json({
      success: true,
      data: readStatuses
    });

  } catch (error) {
    console.error('[Chat] Error fetching read status:', error);
    return res.status(500).json({
      error: 'Failed to fetch read status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
} 