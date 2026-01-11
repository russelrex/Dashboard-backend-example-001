import type { NextApiRequest, NextApiResponse } from 'next';
import cors from '../../../../../src/lib/cors';
import { realtimeService } from '../../../../../src/services/realtimeService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { roomId, userId } = req.query as { roomId: string; userId: string };
  
  if (!roomId || !userId) {
    return res.status(400).json({ error: 'roomId and userId are required' });
  }

  try {
    const { action, userName } = req.body;
    
    if (!action || !userName) {
      return res.status(400).json({ error: 'action and userName are required' });
    }
    
    if (action !== 'join' && action !== 'leave') {
      return res.status(400).json({ error: 'action must be either "join" or "leave"' });
    }
    
    const eventType = action === 'join' ? 'user_joined' : 'user_left';
    await realtimeService.publishUserPresence(roomId, userId, userName, eventType);
    
    return res.status(200).json({ 
      success: true,
      message: `User ${action} event sent successfully`
    });
    
  } catch (error) {
    console.error('[Chat] Error updating presence:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to update presence',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
} 