import type { NextApiRequest, NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import clientPromise from '../../../lib/mongodb';
import cors from '../../../src/lib/cors';
import { CreateRoomRequest } from '../../../src/types/chat';
import { getDbName } from '@/lib/mongodb';

async function getRooms(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const collections = await db.listCollections({ name: 'chat_rooms' }).toArray();
    
    if (collections.length === 0) {
      return res.status(200).json({
        success: true,
        data: []
      });
    }
    
    const rooms = await db.collection('chat_rooms').find({}).sort({ createdAt: -1 }).toArray();
    
    return res.status(200).json({
      success: true,
      data: rooms
    });
    
  } catch (error) {
    console.error('[Chat] Error fetching rooms:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch rooms',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

async function createRoom(req: NextApiRequest, res: NextApiResponse) {
  const { userId } = req.query as { userId: string };
  
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const { roomId, name, description } = req.body as CreateRoomRequest;
    
    if (!roomId || !name) {
      return res.status(400).json({ error: 'roomId and name are required' });
    }
    
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const existingRoom = await db.collection('chat_rooms').findOne({ roomId });
    if (existingRoom) {
      return res.status(409).json({ error: 'Room with this roomId already exists' });
    }
    
    const roomData = {
      roomId,
      name,
      description: description || undefined,
      createdBy: new ObjectId(userId),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await db.collection('chat_rooms').insertOne(roomData);
    
    const newRoom = await db.collection('chat_rooms').findOne({ _id: result.insertedId });
    
    return res.status(201).json({
      success: true,
      data: newRoom,
      message: 'Room created successfully'
    });
    
  } catch (error) {
    console.error('[Chat] Error creating room:', error);
    return res.status(500).json({ 
      error: 'Failed to create room',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  switch (req.method) {
    case 'GET':
      return getRooms(req, res);
    case 'POST':
      return createRoom(req, res);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
} 