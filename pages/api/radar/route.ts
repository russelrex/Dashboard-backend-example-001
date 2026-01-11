// pages/api/radar/route.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { radarBackendService } from '@/services/radarBackendService';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate locationId
  const { locationId } = req.body;
  if (!locationId) {
    return res.status(400).json({ error: 'locationId is required' });
  }

  try {
    const { origin, destination, mode = 'car' } = req.body;

    if (!origin?.latitude || !origin?.longitude) {
      return res.status(400).json({ error: 'Valid origin coordinates required' });
    }

    if (!destination?.latitude || !destination?.longitude) {
      return res.status(400).json({ error: 'Valid destination coordinates required' });
    }

    const result = await radarBackendService.calculateRoute(
      origin,
      destination,
      { mode }
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'No route found'
      });
    }

    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (error: any) {
    console.error('[API] Route calculation error:', error);
    return res.status(500).json({ 
      error: 'Failed to calculate route',
      message: error.message 
    });
  }
} 