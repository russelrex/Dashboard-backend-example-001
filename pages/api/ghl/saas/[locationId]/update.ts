import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../../src/lib/mongodb';
import cors from '../../../../../src/lib/cors';
import axios from 'axios';

interface SaaSUpdateRequest {
  subscriptionId: string;
  customerId: string;
  companyId: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  const { locationId } = req.query;

  if (!locationId || typeof locationId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid locationId' });
  }

  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed. Use PUT.' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    const location = await db.collection('locations').findOne({ locationId });
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const { subscriptionId, customerId, companyId }: SaaSUpdateRequest = req.body;

    if (!subscriptionId) {
      return res.status(400).json({ error: 'subscriptionId is required' });
    }

    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }

    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    const ghlRequestBody = {
      subscriptionId,
      customerId,
      companyId
    };

    console.log(`[SAAS UPDATE] Updating SaaS subscription for location ${locationId}`);

    const ghlUrl = `https://services.leadconnectorhq.com/saas/update-saas-subscription/${locationId}`;
    
    try {
      const ghlResponse = await axios.put(ghlUrl, ghlRequestBody, {
        headers: {
          Authorization: 'Bearer pit-d425bc46-4119-45ea-b7ae-94d617dbdbf7',
          'Content-Type': 'application/json',
          'Version': '2021-07-28',
          'Accept': 'application/json'
        }
      });

      console.log(`[SAAS UPDATE] Successfully updated SaaS subscription for location ${locationId}`);
      
      return res.status(200).json({
        success: true,
        message: `SaaS subscription successfully updated for location ${locationId}`,
        data: ghlResponse.data
      });

    } catch (ghlError: any) {
      console.error('[SAAS UPDATE] GHL API Error:', ghlError.response?.data || ghlError.message);
      
      const status = ghlError.response?.status || 500;
      const errorMessage = ghlError.response?.data?.message || ghlError.response?.data || ghlError.message;
      
      return res.status(status).json({
        error: 'Failed to update SaaS subscription',
        details: errorMessage,
        ghlError: ghlError.response?.data
      });
    }

  } catch (error: any) {
    console.error('[SAAS UPDATE] Unexpected error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}
