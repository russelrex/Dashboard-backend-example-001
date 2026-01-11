// pages/api/ghl/location/[locationId].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import axios from 'axios';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { locationId } = req.query;
  console.log('[GHL LOCATION SYNC] Called with locationId:', locationId);

  if (!locationId || typeof locationId !== 'string') {
    return res.status(400).json({ error: 'Missing locationId' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Get the API key for the location
    const location = await db.collection('locations').findOne({ locationId });
    
    const apiKey = location?.ghlOAuth?.accessToken;
    if (!apiKey) {
      console.warn('[GHL LOCATION SYNC] No API key for location', locationId);
      return res.status(400).json({ error: 'API key not found for this location' });
    }

    console.log('[GHL LOCATION SYNC] Using API key:', apiKey.slice(0, 6) + '...' + apiKey.slice(-4));

    // Call GHL API to get location data
    const url = `https://services.leadconnectorhq.com/locations/${locationId}`;
    console.log('[GHL LOCATION SYNC] Calling GHL with URL:', url);

    let ghlRes;
    try {
      ghlRes = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: '2021-07-28',
          Accept: 'application/json'
        }
      });
      console.log('[GHL LOCATION SYNC] GHL response status:', ghlRes.status);
    } catch (err: any) {
      console.error('[GHL LOCATION SYNC] Error from GHL:', err.response?.data || err.message);
      return res.status(err.response?.status || 500).json({
        error: err.response?.data || err.message
      });
    }

    // Extract location data
    const ghlLocation = ghlRes.data.location;
    console.log('[GHL LOCATION SYNC] Got location data from GHL');

    // Get existing location to check for custom logo
    const existingLocation = await db.collection('locations').findOne({ locationId });
    
    // Update MongoDB with GHL data
    const updateData: any = {
      // Basic info
      name: ghlLocation.name,
      address: ghlLocation.address,
      city: ghlLocation.city,
      state: ghlLocation.state,
      country: ghlLocation.country,
      postalCode: ghlLocation.postalCode,
      website: ghlLocation.website,
      timezone: ghlLocation.timezone,
      firstName: ghlLocation.firstName,
      lastName: ghlLocation.lastName,
      email: ghlLocation.email,
      phone: ghlLocation.phone,
      
      // Business info - PROTECT CUSTOM LOGO
      business: {
        ...(ghlLocation.business || {}),
        // Only update logoUrl from GHL if there's NO custom Cloudflare logo
        logoUrl: existingLocation?.company?.cloudflareImageId 
          ? existingLocation.company.logoUrl  // Keep existing Cloudflare logo
          : (ghlLocation.logoUrl || ghlLocation.business?.logoUrl),  // Use GHL logo
        // Preserve cloudflareImageId if it exists
        ...(existingLocation?.company?.cloudflareImageId && { 
          cloudflareImageId: existingLocation.company.cloudflareImageId 
        })
      },
      
      // Social info
      social: ghlLocation.social || {},
      
      // Settings from GHL
      settings: ghlLocation.settings || {},
      
      // Metadata
      ghlSyncedAt: new Date(),
      lastModifiedBy: 'ghl-sync'
    };

    const result = await db.collection('locations').updateOne(
      { locationId },
      { 
        $set: updateData,
        $currentDate: { lastModified: true }
      }
    );

    console.log('[GHL LOCATION SYNC] MongoDB updated, modified:', result.modifiedCount);

    return res.status(200).json({
      success: true,
      location: ghlLocation,
      updated: result.modifiedCount > 0
    });

  } catch (error: any) {
    console.error('[GHL LOCATION SYNC] General error:', error.message);
    return res.status(500).json({ 
      error: 'Failed to sync location data', 
      detail: error.message 
    });
  }
}