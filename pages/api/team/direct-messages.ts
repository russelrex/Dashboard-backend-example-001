// pages/api/team/direct-messages.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';

// Auth middleware
async function verifyAuth(req: NextApiRequest) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    throw new Error('No token provided');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    return decoded;
  } catch (error) {
    throw new Error('Invalid token');
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const authUser = await verifyAuth(req);
    const client = await clientPromise;
    const db = client.db(getDbName());

    switch (req.method) {
      case 'GET':
        return await getDirectMessages(req, res, db, authUser);
      case 'POST':
        return await startDirectMessage(req, res, db, authUser);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error: any) {
    console.error('[Direct Messages API] Error:', error);
    
    if (error.message === 'No token provided' || error.message === 'Invalid token') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

async function getDirectMessages(
  req: NextApiRequest,
  res: NextApiResponse,
  db: any,
  authUser: any
) {
  const { locationId, userId } = req.query;
  
  if (!locationId || !userId) {
    return res.status(400).json({ error: 'Location ID and User ID required' });
  }

  // Get all DM conversations for this user
  const conversations = await db.collection('dm_conversations')
    .find({
      locationId: locationId as string,
      participants: userId as string,
      deleted: { $ne: true }
    })
    .sort({ updatedAt: -1 })
    .toArray();

  // Get user details for participants
  const allParticipants = new Set<string>();
  conversations.forEach((conv: any) => {
    conv.participants.forEach((p: string) => allParticipants.add(p));
  });

  const users = await db.collection('users')
    .find({
      _id: { $in: Array.from(allParticipants).map(id => {
        try {
          return new ObjectId(id);
        } catch {
          return id; // Handle non-ObjectId user IDs
        }
      })}
    })
    .toArray();

  const userMap = new Map(users.map((u: any) => [u._id.toString(), u]));

  // Get last message and unread counts for each conversation
  const conversationsWithDetails = await Promise.all(
    conversations.map(async (conv: any) => {
      // Get last message
      const lastMessage = await db.collection('team_messages')
        .findOne(
          { 
            conversationId: conv._id.toString(),
            isDirect: true 
          },
          { sort: { createdAt: -1 } }
        );

      // Get unread count
      const unreadCount = await db.collection('team_messages')
        .countDocuments({
          conversationId: conv._id.toString(),
          isDirect: true,
          userId: { $ne: userId },
          readBy: { $ne: userId }
        });

      // Get other participant details
      const otherParticipantId = conv.participants.find((p: string) => p !== userId);
      const otherUser = userMap.get(otherParticipantId) || {
        _id: otherParticipantId,
        name: 'Unknown User',
        email: ''
      };

      return {
        _id: conv._id.toString(),
        conversationId: conv._id.toString(),
        participants: conv.participants,
        otherUser: {
          userId: otherUser._id || otherUser.userId,
          name: otherUser.name || `${otherUser.firstName || ''} ${otherUser.lastName || ''}`.trim(),
          email: otherUser.email,
          avatar: otherUser.avatar,
          status: 'offline' // Will be updated by presence
        },
        lastMessage,
        unreadCount,
        updatedAt: conv.updatedAt
      };
    })
  );

  return res.status(200).json({ 
    conversations: conversationsWithDetails
  });
}

async function startDirectMessage(
  req: NextApiRequest,
  res: NextApiResponse,
  db: any,
  authUser: any
) {
  const { locationId, targetUserId } = req.body;

  if (!locationId || !targetUserId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Create consistent DM channel ID
    const participants = [authUser.userId, targetUserId].sort();
    const dmChannelId = `dm:${participants.join(':')}`;

    // Check if conversation exists
    let conversation = await db.collection('dm_conversations').findOne({
      channelId: dmChannelId,
      locationId,
    });

    if (!conversation) {
      // Create new DM conversation
      conversation = {
        _id: new ObjectId(),
        channelId: dmChannelId,
        locationId,
        participants,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastMessage: null,
        unreadCount: {
          [authUser.userId]: 0,
          [targetUserId]: 0,
        }
      };

      await db.collection('dm_conversations').insertOne(conversation);
    }

    // Get target user info
    const targetUser = await db.collection('users').findOne({ 
      _id: new ObjectId(targetUserId) 
    });

    return res.status(200).json({
      conversation: {
        ...conversation,
        targetUser: {
          userId: targetUser._id.toString(),
          name: targetUser.name,
          email: targetUser.email,
        }
      }
    });
  } catch (error) {
    console.error('[DM] Start conversation error:', error);
    return res.status(500).json({ error: 'Failed to start conversation' });
  }
}