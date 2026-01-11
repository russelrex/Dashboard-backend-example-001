import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import cors from '@/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError } from '../../../../src/utils/httpResponses';
import axios from 'axios';
import { GHL_ENDPOINTS } from '../../../../constants/ghl';

interface LocationSearchQuery {
  email?: string;
  companyId?: string;
  limit?: string;
  order?: 'asc' | 'desc';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  return await getLocationByEmail(req, res);
}

async function getLocationByEmail(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      email,
      companyId,
      limit = '10',
      order = 'asc'
    }: LocationSearchQuery = req.query;

    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

    const params: any = {
      companyId,
      limit: limitNum,
      order
    };
    
    if (email && typeof email === 'string' && email.trim()) {
      params.email = email.trim();
    }

    const response = await axios.get(GHL_ENDPOINTS.LOCATIONS.search, {
      headers: {
        'Authorization': `Bearer ${process.env.GHL_PRIVATE_KEY_USER_CREATE}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json'
      },
      params,
      timeout: 15000
    });

    const locations = response.data.locations || [];
    const totalCount = response.data.count || locations.length;

    return sendSuccess(res, {
      locations,
      totalCount,
      searchParams: {
        email: email?.trim() || null,
        companyId: companyId,
        limit: limitNum,
        order
      }
    }, 'Location search completed successfully');

  } catch (error: any) {
    console.error('Error searching location by email:', error);
    
    if (error.response?.status === 429) {
      return res.status(429).json({ 
        error: 'GHL API rate limit exceeded',
        retryAfter: error.response.headers['retry-after'] || 60
      });
    }
    
    if (error.response?.status === 401) {
      return res.status(401).json({ 
        error: 'Unauthorized - Invalid or expired token'
      });
    }

    return sendServerError(res, error, 'Failed to search location by email');
  }
}
