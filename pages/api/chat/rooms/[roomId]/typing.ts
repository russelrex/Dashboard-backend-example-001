import type { NextApiRequest, NextApiResponse } from 'next';
import cors from '../../../../../src/lib/cors';
import { realtimeService } from '../../../../../src/services/realtimeService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { roomId } = req.query as { roomId: string };
  
  if (!roomId) {
    return res.status(400).json({ error: 'roomId is required' });
  }

  try {
    const { isTyping, userName, userId } = req.body;
    
    if (typeof isTyping !== 'boolean' || !userName || !userId) {
      return res.status(400).json({ error: 'isTyping (boolean), userName, and userId are required' });
    }
    
    await realtimeService.publishTypingIndicator(roomId, userId, userName, isTyping);
    
    return res.status(200).json({ 
      success: true,
      message: 'Typing indicator sent successfully'
    });
    
  } catch (error) {
    console.error('[Chat] Error sending typing indicator:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to send typing indicator',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
} 