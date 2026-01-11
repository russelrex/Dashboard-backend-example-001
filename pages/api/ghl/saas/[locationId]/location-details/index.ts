import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../../../src/lib/mongodb';
import cors from '../../../../../../src/lib/cors';
import axios from 'axios';

interface SaaSSubscriptionData {
  isSaaSV2: boolean;
  subscriptionId: string;
  customerId: string;
  locationId: string;
  companyId: string;
  saasMode: string;
  productId: string;
  priceId: string;
  saasPlanId: string;
  subscriptionStatus: string;
}

interface SaaSLocationDetailsResponse {
  success: boolean;
  data: SaaSSubscriptionData;
  locationId: string;
  companyId: string;
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
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Get location details to retrieve companyId
    const location = await db.collection('locations').findOne({ locationId });
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    if (!location.companyId) {
      return res.status(400).json({ error: 'Location does not have a companyId' });
    }

    console.log(`[SAAS LOCATION DETAILS] Getting subscription details for location ${locationId}, company ${location.companyId}`);

    const ghlUrl = `https://services.leadconnectorhq.com/saas/get-saas-subscription/${locationId}`;
    
    try {
      const ghlResponse = await axios.get(ghlUrl, {
        headers: {
          Authorization: `Bearer ${process.env.GHL_PRIVATE_KEY_USER_CREATE}`,
          'Content-Type': 'application/json',
          'Version': '2021-04-15',
          'Accept': 'application/json'
        },
        params: {
          companyId: location.companyId
        }
      });

      console.log(`[SAAS LOCATION DETAILS] Successfully retrieved subscription details for location ${locationId}`);
      
      const response: SaaSLocationDetailsResponse = {
        success: true,
        data: ghlResponse.data as SaaSSubscriptionData,
        locationId,
        companyId: location.companyId
      };

      return res.status(200).json(response);

    } catch (ghlError: any) {
      console.error('[SAAS LOCATION DETAILS] GHL API Error:', ghlError.response?.data || ghlError.message);
      
      const status = ghlError.response?.status || 500;
      const errorMessage = ghlError.response?.data?.message || ghlError.response?.data || ghlError.message;
      
      return res.status(status).json({
        error: 'Failed to get SaaS subscription details',
        details: errorMessage,
        ghlError: ghlError.response?.data
      });
    }

  } catch (error: any) {
    console.error('[SAAS LOCATION DETAILS] Unexpected error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}
