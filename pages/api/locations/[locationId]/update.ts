import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import cors from '@/lib/cors';
import { sendSuccess, sendServerError, sendBadRequest } from '../../../../src/utils/httpResponses';

interface UpdateLocationRequest {
  name?: string;
  companyName?: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  timezone?: string;
  appInstalled?: boolean;
  hasCompanyOAuth?: boolean;
  business?: any;
  social?: any;
  isOnboardingComplete?: boolean;
  isOnboardingRestarting?: boolean;

}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'PATCH') {
    res.setHeader('Allow', ['PATCH']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  return await updateLocation(req, res);
}

async function updateLocation(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Get locationId from URL parameter
    const { locationId } = req.query;
    
    if (!locationId || typeof locationId !== 'string') {
      return sendBadRequest(res, 'locationId is required in the URL path');
    }

    const updateData: UpdateLocationRequest = req.body;

    // Check if location exists
    const existingLocation = await db.collection('locations').findOne({ 
      locationId: locationId 
    });

    if (!existingLocation) {
      return sendBadRequest(res, 'Location not found with the provided locationId');
    }

    // Remove undefined values from update data
    const cleanUpdateFields = Object.fromEntries(
      Object.entries(updateData).filter(([_, value]) => value !== undefined)
    );

    if (Object.keys(cleanUpdateFields).length === 0) {
      return sendBadRequest(res, 'No valid fields provided for update');
    }

    // Add updatedAt timestamp
    cleanUpdateFields.updatedAt = new Date();

    // Update the location
    const result = await db.collection('locations').findOneAndUpdate(
      { locationId: locationId },
      { $set: cleanUpdateFields },
      { returnDocument: 'after' }
    );

    if (!result) {
      return sendServerError(res, 'Failed to update location', 'Database operation returned null');
    }

    // Format the updated location for response
    const updatedLocation = {
      _id: result._id,
      locationId: result.locationId,
      name: result.name,
      companyName: result.companyName,
      email: result.email,
      phone: result.phone,
      website: result.website,
      address: result.address,
      city: result.city,
      state: result.state,
      country: result.country,
      postalCode: result.postalCode,
      timezone: result.timezone,
      appInstalled: result.appInstalled || false,
      hasCompanyOAuth: result.hasCompanyOAuth || false,
      business: result.business || {},
      social: result.social || {},
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      lastWebhookUpdate: result.lastWebhookUpdate,
      isOnboardingComplete: result.isOnboardingComplete || false,
      isOnboardingRestarting: result.isOnboardingRestarting || false
    };

    return sendSuccess(res, {
      location: updatedLocation,
      message: 'Location updated successfully'
    });

  } catch (error) {
    console.error('Error updating location:', error);
    return sendServerError(res, error, 'Failed to update location');
  }
}
