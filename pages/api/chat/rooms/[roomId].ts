import type { NextApiRequest, NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import clientPromise from '../../../../lib/mongodb';
import cors from '../../../../src/lib/cors';
import { CreateRoomRequest } from '../../../../src/types/chat';
import { getDbName } from '@/lib/mongodb';

async function getRoom(req: NextApiRequest, res: NextApiResponse) {
  const { roomId } = req.query as { roomId: string };
  
  if (!roomId) {
    return res.status(400).json({ error: 'roomId is required' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const room = await db.collection('chat_rooms').findOne({ roomId });
    
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    return res.status(200).json({
      success: true,
      data: room
    });
    
  } catch (error) {
    console.error('[Chat] Error fetching room:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch room',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

async function updateRoom(req: NextApiRequest, res: NextApiResponse) {
  const { roomId, userId } = req.query as { roomId: string; userId: string };
  
  if (!roomId || !userId) {
    return res.status(400).json({ error: 'roomId and userId are required' });
  }

  try {
    const { name, description } = req.body as Partial<CreateRoomRequest>;
    
    if (!name && description === undefined) {
      return res.status(400).json({ error: 'At least name or description must be provided' });
    }
    
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const room = await db.collection('chat_rooms').findOne({ roomId });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    if (room.createdBy.toString() !== userId) {
      return res.status(403).json({ error: 'Only room creator can update the room' });
    }
    
    const updateData: any = {
      updatedAt: new Date()
    };
    
    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    
    const result = await db.collection('chat_rooms').updateOne(
      { roomId },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    const updatedRoom = await db.collection('chat_rooms').findOne({ roomId });
    
    return res.status(200).json({
      success: true,
      data: updatedRoom,
      message: 'Room updated successfully'
    });
    
  } catch (error) {
    console.error('[Chat] Error updating room:', error);
    return res.status(500).json({ 
      error: 'Failed to update room',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

async function deleteRoom(req: NextApiRequest, res: NextApiResponse) {
  const { roomId, userId } = req.query as { roomId: string; userId: string };
  
  if (!roomId || !userId) {
    return res.status(400).json({ error: 'roomId and userId are required' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const room = await db.collection('chat_rooms').findOne({ roomId });
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    if (room.createdBy.toString() !== userId) {
      return res.status(403).json({ error: 'Only room creator can delete the room' });
    }
    
    await Promise.all([
      db.collection('chat_rooms').deleteOne({ roomId }),
      db.collection('chat_messages').deleteMany({ roomId })
    ]);
    
    return res.status(200).json({
      success: true,
      message: 'Room and all messages deleted successfully'
    });
    
  } catch (error) {
    console.error('[Chat] Error deleting room:', error);
    return res.status(500).json({ 
      error: 'Failed to delete room',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  switch (req.method) {
    case 'GET':
      return getRoom(req, res);
    case 'PUT':
      return updateRoom(req, res);
    case 'DELETE':
      return deleteRoom(req, res);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
} 