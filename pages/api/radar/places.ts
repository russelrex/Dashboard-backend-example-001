// pages/api/radar/places.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { radarBackendService } from '@/services/radarBackendService';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate locationId from query params
  const { locationId } = req.query;
  if (!locationId || typeof locationId !== 'string') {
    return res.status(400).json({ error: 'locationId is required' });
  }

  try {
    const { query, lat, lng, radius, limit } = req.query;

    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const near = lat && lng ? {
      latitude: parseFloat(lat as string),
      longitude: parseFloat(lng as string)
    } : undefined;

    const results = await radarBackendService.searchPlaces(
      query as string,
      near,
      {
        radius: radius ? parseInt(radius as string) : 1000,
        limit: limit ? parseInt(limit as string) : 10
      }
    );

    return res.status(200).json({
      success: true,
      places: results,
      count: results.length
    });
  } catch (error: any) {
    console.error('[API] Place search error:', error);
    return res.status(500).json({ 
      error: 'Failed to search places',
      message: error.message 
    });
  }
} 