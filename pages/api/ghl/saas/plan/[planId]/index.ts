import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import cors from '@/lib/cors';

interface SaaSPlanPrice {
  id: string;
  billingInterval: string;
  active: boolean;
  amount: number;
  currency: string;
  symbol: string;
}

interface SaaSPlanData {
  planId: string;
  companyId: string;
  title: string;
  description: string;
  saasProducts: string[];
  addOns: string[];
  planLevel: number;
  trialPeriod: number;
  setupFee: number;
  userLimit: number;
  contactLimit: number;
  prices: SaaSPlanPrice[];
  categoryId: string;
  snapshotId: string;
  productId: string;
  isSaaSV2: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SaaSPlanResponse {
  success: boolean;
  data: SaaSPlanData;
  planId: string;
  companyId: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  const { planId } = req.query;

  if (!planId || typeof planId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid planId' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  try {
    // Get companyId from query parameters
    const { companyId } = req.query;

    if (!companyId || typeof companyId !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid companyId' });
    }

    console.log(`[SAAS PLAN] Getting plan details for planId ${planId}, company ${companyId}`);

    const ghlUrl = `https://services.leadconnectorhq.com/saas/saas-plan/${planId}`;
    
    try {
      const ghlResponse = await axios.get(ghlUrl, {
        headers: {
          Authorization: `Bearer ${process.env.GHL_PRIVATE_KEY_USER_CREATE}`,
          'Content-Type': 'application/json',
          'Version': '2021-04-15',
          'Accept': 'application/json'
        },
        params: {
          companyId: companyId
        }
      });

      console.log(`[SAAS PLAN] Successfully retrieved plan details for planId ${planId}`);
      
      const response: SaaSPlanResponse = {
        success: true,
        data: ghlResponse.data as SaaSPlanData,
        planId,
        companyId
      };

      return res.status(200).json(response);

    } catch (ghlError: any) {
      console.error('[SAAS PLAN] GHL API Error:', ghlError.response?.data || ghlError.message);
      
      const status = ghlError.response?.status || 500;
      const errorMessage = ghlError.response?.data?.message || ghlError.response?.data || ghlError.message;
      
      return res.status(status).json({
        error: 'Failed to get SaaS plan details',
        details: errorMessage,
        ghlError: ghlError.response?.data
      });
    }

  } catch (error: any) {
    console.error('[SAAS PLAN] Unexpected error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}
