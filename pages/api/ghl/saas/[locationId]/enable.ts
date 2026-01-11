import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../../src/lib/mongodb';
import cors from '../../../../../src/lib/cors';
import axios from 'axios';

interface SaaSEnableRequest {
  companyId: string;
  isSaaSV2: boolean;
  providerLocationId: string;
  saasPlanId: string;
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
    const {
      companyId,
      isSaaSV2,
      providerLocationId,
      saasPlanId
    }: SaaSEnableRequest = req.body;

    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    if (typeof isSaaSV2 !== 'boolean') {
      return res.status(400).json({ error: 'isSaaSV2 is required and must be a boolean' });
    }

    if (!providerLocationId) {
      return res.status(400).json({ error: 'providerLocationId is required' });
    }

    if (!saasPlanId) {
      return res.status(400).json({ error: 'saasPlanId is required' });
    }

    const ghlRequestBody = {
      companyId,
      isSaaSV2,
      providerLocationId,
      saasPlanId
    };
    console.log('====', ghlRequestBody);

    console.log(`[SAAS ENABLE] Enabling SaaS for location ${locationId}, version: ${isSaaSV2 ? 'V2' : 'V1'}`);

    const ghlUrl = `https://services.leadconnectorhq.com/saas/enable-saas/${locationId}`;
    
    try {
      const ghlResponse = await axios.post(ghlUrl, ghlRequestBody, {
        headers: {
          'Authorization': 'Bearer pit-d425bc46-4119-45ea-b7ae-94d617dbdbf7',
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
        }
      });

      console.log(`[SAAS ENABLE] Successfully enabled SaaS for location ${locationId}`);
      
      return res.status(200).json({
        success: true,
        message: `SaaS ${isSaaSV2 ? 'V2' : 'V1'} successfully enabled for location ${locationId}`,
        data: ghlResponse.data
      });

    } catch (ghlError: any) {
      console.error('[SAAS ENABLE] GHL API Error:', ghlError.response?.data || ghlError.message);
      
      const status = ghlError.response?.status || 500;
      const errorMessage = ghlError.response?.data?.message || ghlError.response?.data || ghlError.message;
      
      return res.status(status).json({
        error: 'Failed to enable SaaS',
        details: errorMessage,
        ghlError: ghlError.response?.data
      });
    }

  } catch (error: any) {
    console.error('[SAAS ENABLE] Unexpected error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}
