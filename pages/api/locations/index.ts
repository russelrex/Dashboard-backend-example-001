// pages/api/locations/index.ts
// API endpoint to fetch all locations with pagination and filtering
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '@/lib/cors';
import { sendPaginated, sendServerError } from '../../../src/utils/httpResponses';

interface LocationsQuery {
  page?: string;
  limit?: string;
  search?: string;
  active?: string;
  companyId?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'GET') {
    return await getAllLocations(req, res);
  } else {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function getAllLocations(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Parse query parameters
    const {
      page = '1',
      limit = '50',
      search = '',
      active = '',
      companyId = ''
    }: LocationsQuery = req.query;

    // Convert to numbers and validate
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50)); // Max 100 per page
    const skip = (pageNum - 1) * limitNum;

    // Build filter query
    const filter: any = {};

    // Search filter (searches in name, email, companyName)
    if (search.trim()) {
      filter.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { email: { $regex: search.trim(), $options: 'i' } },
        { companyName: { $regex: search.trim(), $options: 'i' } }
      ];
    }

    // Active filter
    if (active === 'true') {
      filter.appInstalled = true;
    } else if (active === 'false') {
      filter.appInstalled = false;
    }

    // Company ID filter
    if (companyId.trim()) {
      filter.companyId = companyId.trim();
    }

    // Get total count for pagination
    const totalCount = await db.collection('locations').countDocuments(filter);
    
    // Fetch locations with pagination
    const locations = await db.collection('locations')
      .find(filter)
      .sort({ createdAt: -1 }) // Most recent first
      .skip(skip)
      .limit(limitNum)
      .toArray();

    // Transform locations to include only necessary fields
    const formattedLocations = locations.map(location => ({
      _id: location._id,
      locationId: location.locationId,
      name: location.name,
      companyName: location.companyName,
      email: location.email,
      phone: location.phone,
      website: location.website,
      address: location.address,
      city: location.city,
      state: location.state,
      country: location.country,
      postalCode: location.postalCode,
      timezone: location.timezone,
      appInstalled: location.appInstalled || false,
      hasCompanyOAuth: location.hasCompanyOAuth || false,
      business: location.business || {},
      social: location.social || {},
      createdAt: location.createdAt,
      updatedAt: location.updatedAt,
      lastWebhookUpdate: location.lastWebhookUpdate
    }));

    // Add filters to the response data for reference
    const responseData = {
      locations: formattedLocations,
      filters: {
        search: search || null,
        active: active || null,
        companyId: companyId || null
      }
    };

    return sendPaginated(
      res,
      responseData.locations,
      {
        page: pageNum,
        limit: limitNum,
        total: totalCount
      },
      'Locations retrieved successfully'
    );

  } catch (error) {
    console.error('Error fetching locations:', error);
    return sendServerError(res, error, 'Failed to fetch locations');
  }
} 