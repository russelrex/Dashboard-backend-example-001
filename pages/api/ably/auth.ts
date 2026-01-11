import type { NextApiRequest, NextApiResponse } from 'next';
import Ably from 'ably';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Add CORS headers AND content-type
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const ably = new Ably.Rest(process.env.ABLY_API_KEY!);
    
    const tokenRequest = await ably.auth.createTokenRequest({
      capability: {
        'location:*': ['subscribe'],
        'installation:*': ['subscribe'],
        'progress:*': ['subscribe']
      }
    });

    return res.status(200).json(tokenRequest);
  } catch (error) {
    console.error('Ably auth error:', error);
    return res.status(500).json({ error: 'Failed to create Ably token' });
  }
}
