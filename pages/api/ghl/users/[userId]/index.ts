import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import cors from '@/lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  const { userId } = req.query;

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid userId' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  try {
    console.log(`[GHL USER] Getting user details for userId ${userId}`);

    const ghlUrl = `https://services.leadconnectorhq.com/users/${userId}`;
    
    try {
      const ghlResponse = await axios.get(ghlUrl, {
        headers: {
          Authorization: `Bearer ${process.env.GHL_PRIVATE_KEY_USER_CREATE}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28',
          'Accept': 'application/json'
        }
      });

      console.log(`[GHL USER] Successfully retrieved user details for userId ${userId}`);
      
      return res.status(200).json({
        success: true,
        data: ghlResponse.data,
        userId
      });

    } catch (ghlError: any) {
      console.error('[GHL USER] GHL API Error:', ghlError.response?.data || ghlError.message);
      
      const status = ghlError.response?.status || 500;
      const errorMessage = ghlError.response?.data?.message || ghlError.response?.data || ghlError.message;
      
      return res.status(status).json({
        error: 'Failed to get user details',
        details: errorMessage,
        ghlError: ghlError.response?.data
      });
    }

  } catch (error: any) {
    console.error('[GHL USER] Unexpected error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}
