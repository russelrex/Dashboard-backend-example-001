// pages/api/radar/geocode.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { radarBackendService } from '@/services/radarBackendService';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate locationId (optional for geocoding, but good practice)
  const { locationId } = req.body;
  if (!locationId) {
    return res.status(400).json({ error: 'locationId is required' });
  }

  try {
    const { address, contactId } = req.body;

    if (!address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    // Use the smart validation that tries multiple variations
    const result = await radarBackendService.validateAddress(address);
    
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('[API] Geocode error:', error);
    return res.status(500).json({ 
      error: 'Failed to geocode address',
      message: error.message 
    });
  }
}