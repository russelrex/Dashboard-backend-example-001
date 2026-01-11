import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../../src/lib/mongodb';
import cors from '../../../../../src/lib/cors';
import axios from 'axios';

interface SaaSDisableRequest {
  locationIds: string[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  const { locationId } = req.query;

  if (!locationId || typeof locationId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid locationId' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    const location = await db.collection('locations').findOne({ locationId: locationId });
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    if (!location.companyId) {
      return res.status(400).json({ error: 'Location does not have a companyId' });
    }

    const { locationIds }: SaaSDisableRequest = req.body;

    if (!locationIds || !Array.isArray(locationIds) || locationIds.length === 0) {
      return res.status(400).json({ error: 'locationIds is required and must be a non-empty array' });
    }

    const ghlRequestBody = {
      locationIds
    };

    console.log(`[SAAS DISABLE] Disabling SaaS for company ${location.companyId}, locations: ${locationIds.join(', ')}`);

    const ghlUrl = `https://services.leadconnectorhq.com/saas/bulk-disable-saas/${location.companyId}`;
    
    try {
      const ghlResponse = await axios.post(ghlUrl, ghlRequestBody, {
        headers: {
          Authorization: 'Bearer pit-d425bc46-4119-45ea-b7ae-94d617dbdbf7',
          'Content-Type': 'application/json',
          'Version': '2021-07-28',
          'Accept': 'application/json'
        }
      });

      console.log(`[SAAS DISABLE] Successfully disabled SaaS for locations: ${locationIds.join(', ')}`);
      
      return res.status(200).json({
        success: true,
        message: `SaaS successfully disabled for ${locationIds.length} location(s)`,
        data: ghlResponse.data
      });

    } catch (ghlError: any) {
      console.error('[SAAS DISABLE] GHL API Error:', ghlError.response?.data || ghlError.message);
      
      const status = ghlError.response?.status || 500;
      const errorMessage = ghlError.response?.data?.message || ghlError.response?.data || ghlError.message;
      
      return res.status(status).json({
        error: 'Failed to disable SaaS',
        details: errorMessage,
        ghlError: ghlError.response?.data
      });
    }

  } catch (error: any) {
    console.error('[SAAS DISABLE] Unexpected error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}
