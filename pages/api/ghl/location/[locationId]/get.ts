import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import cors from '@/lib/cors';
import { GHLGetLocationResponse } from '@/interfaces/locations';

interface GetLocationResponse {
  success: boolean;
  data: GHLGetLocationResponse;
  locationId: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  const { locationId } = req.query;

  if (!locationId || typeof locationId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid locationId' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  try {
    console.log(`[GHL LOCATION GET] Getting location details for locationId ${locationId}`);

    const ghlUrl = `https://services.leadconnectorhq.com/locations/${locationId}`;
    
    try {
      const ghlResponse = await axios.get(ghlUrl, {
        headers: {
          Authorization: `Bearer ${process.env.GHL_PRIVATE_KEY_USER_CREATE}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28',
          'Accept': 'application/json'
        }
      });

      console.log(`[GHL LOCATION GET] Successfully retrieved location details for locationId ${locationId}`);
      
      const response: GetLocationResponse = {
        success: true,
        data: ghlResponse.data as GHLGetLocationResponse,
        locationId
      };

      return res.status(200).json(response);

    } catch (ghlError: any) {
      console.error('[GHL LOCATION GET] GHL API Error:', ghlError.response?.data || ghlError.message);
      
      const status = ghlError.response?.status || 500;
      const errorMessage = ghlError.response?.data?.message || ghlError.response?.data || ghlError.message;
      
      return res.status(status).json({
        error: 'Failed to get location details',
        details: errorMessage,
        ghlError: ghlError.response?.data
      });
    }

  } catch (error: any) {
    console.error('[GHL LOCATION GET] Unexpected error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}
