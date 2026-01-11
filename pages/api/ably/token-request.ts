import type { NextApiRequest, NextApiResponse } from 'next';
import * as Ably from 'ably';
import cors from '../../../src/lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, userName } = req.body;

    if (!process.env.ABLY_API_KEY) {
      throw new Error('ABLY_API_KEY is not configured');
    }

    if (!userId) {
      return res.status(400).json({ 
        success: false,
        error: 'User ID is required' 
      });
    }

    const ablyClient = new Ably.Rest({
      key: process.env.ABLY_API_KEY
    });

    const tokenRequest = await ablyClient.auth.createTokenRequest({
      clientId: `user_${userId}`,
      ttl: 60 * 60 * 1000,
      capability: {
        'chat:*': ['subscribe', 'presence']
      }
    });

    return res.status(200).json({
      success: true,
      tokenRequest
    });

  } catch (error) {
    console.error('Failed to generate Ably token:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to generate authentication token',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
} 