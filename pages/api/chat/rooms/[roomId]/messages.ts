import type { NextApiRequest, NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import clientPromise from '../../../../../lib/mongodb';
import cors from '../../../../../src/lib/cors';
import { MessageListQuery, SendMessageRequest, ChatReadStatus } from '../../../../../src/types/chat';
import { realtimeService } from '../../../../../src/services/realtimeService';
import { getDbName } from '../../../../../src/lib/mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  switch (req.method) {
    case 'GET':
      return getMessages(req, res);
    case 'POST':
      return sendMessage(req, res);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
} 

async function getMessages(req: NextApiRequest, res: NextApiResponse) {
  const { roomId, userId } = req.query as { roomId: string; userId: string };
  const { page = 1, limit = 50, before, after } = req.query as MessageListQuery;

  if (!roomId) {
    return res.status(400).json({ error: 'roomId is required' });
  }

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const room = await db.collection('chat_rooms').findOne({ roomId });
    if (!room) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false
        }
      });
    }
    
    const skip = (Number(page) - 1) * Number(limit);
    
    let dateFilter: any = {};
    if (before) {
      dateFilter.createdAt = { $lt: new Date(before.toString()) };
    }
    if (after) {
      dateFilter.createdAt = { 
        ...dateFilter.createdAt, 
        $gt: new Date(after.toString()) 
      };
    }
    
    const matchFilter = {
      roomId,
      ...dateFilter
    };
    
    const pipeline = [
      { $match: matchFilter },
      {
        $lookup: {
          from: 'users',
          localField: 'sender',
          foreignField: '_id',
          as: 'senderInfo'
        }
      },
      {
        $project: {
          _id: 1,
          roomId: 1,
          sender: {
            _id: { $arrayElemAt: ['$senderInfo._id', 0] },
            firstName: { $arrayElemAt: ['$senderInfo.firstName', 0] },
            lastName: { $arrayElemAt: ['$senderInfo.lastName', 0] },
            avatar: { $arrayElemAt: ['$senderInfo.avatar', 0] }
          },
          text: 1,
          attachments: 1,
          readBy: 1,
          createdAt: 1,
          isRead: { $in: [userId, { $ifNull: ['$readBy', []] }] }
        }
      },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: Number(limit) }
    ];
    
    const [messages, totalCount] = await Promise.all([
      db.collection('chat_messages').aggregate(pipeline).toArray(),
      db.collection('chat_messages').countDocuments(matchFilter)
    ]);
    
    const totalPages = Math.ceil(totalCount / Number(limit));
    const currentPage = Number(page);
    
    return res.status(200).json({
      success: true,
      data: messages,
      pagination: {
        page: currentPage,
        limit: Number(limit),
        total: totalCount,
        totalPages,
        hasNext: currentPage < totalPages,
        hasPrev: currentPage > 1
      }
    });
    
  } catch (error) {
    console.error('[Chat] Error fetching messages:', error);
    return res.status(500).json({
      error: 'Failed to fetch messages',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

async function sendMessage(req: NextApiRequest, res: NextApiResponse) {
  const { roomId, userId } = req.query as { roomId: string; userId: string };
  
  if (!roomId || !userId) {
    return res.status(400).json({ error: 'roomId and userId are required' });
  }

  try {
    const { text, attachments } = req.body as SendMessageRequest;
    
    if (!text?.trim() && (!attachments || attachments.length === 0)) {
      return res.status(400).json({ error: 'Message text or attachments required' });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const userObjectId = new ObjectId(userId);
    
    const existingRoom = await db.collection('chat_rooms').findOne({ roomId });
    if (!existingRoom) {
      const roomData = {
        roomId,
        name: roomId,
        description: undefined,
        createdBy: userObjectId,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      await db.collection('chat_rooms').insertOne(roomData);
    }

    const messageData = {
      roomId,
      sender: new ObjectId(userId),
      text: text?.trim() || '',
      attachments: attachments || [],
      readBy: [userId],
      createdAt: new Date()
    };

    const result = await db.collection('chat_messages').insertOne(messageData);
    
    const newMessage = await db.collection('chat_messages').aggregate([
      { $match: { _id: result.insertedId } },
      {
        $lookup: {
          from: 'users',
          localField: 'sender',
          foreignField: '_id',
          as: 'senderInfo'
        }
      },
      {
        $project: {
          _id: 1,
          roomId: 1,
          sender: {
            _id: { $arrayElemAt: ['$senderInfo._id', 0] },
            firstName: { $arrayElemAt: ['$senderInfo.firstName', 0] },
            lastName: { $arrayElemAt: ['$senderInfo.lastName', 0] },
            avatar: { $arrayElemAt: ['$senderInfo.avatar', 0] }
          },
          text: 1,
          attachments: 1,
          readBy: 1,
          createdAt: 1,
          isRead: true
        }
      }
    ]).toArray();

    const messageWithSender = newMessage[0];

    try {
      await realtimeService.publishNewMessage(roomId, messageWithSender, userId);
    } catch (realtimeError) {
      console.error('[Chat] Failed to publish message to realtime:', realtimeError);
    }

    await db.collection('chat_rooms').updateOne(
      { roomId },
      { $set: { updatedAt: new Date() } }
    );

    return res.status(201).json({
      success: true,
      data: messageWithSender,
      message: 'Message sent successfully'
    });
    
  } catch (error) {
    console.error('[Chat] Error sending message:', error);
    return res.status(500).json({
      error: 'Failed to send message',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}