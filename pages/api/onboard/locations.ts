import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '@/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError, sendConflict, sendNotFound } from '../../../src/utils/httpResponses';
import { DynamicCreateLocationRequest } from '../../../src/interfaces/locations';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  switch (req.method) {
    case 'POST':
      return await createLocation(req, res);
    case 'GET':
      return await getLocations(req, res);
    case 'PUT':
      return await updateLocation(req, res);
    case 'DELETE':
      return await deleteLocation(req, res);
    default:
      res.setHeader('Allow', ['POST', 'GET', 'PUT', 'DELETE']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function createLocation(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const locationData: DynamicCreateLocationRequest = req.body;

    if (!locationData.companyName || !locationData.email || !locationData.phone) {
      return sendBadRequest(res, 'Missing required fields: companyName, email, phone are required');
    }

    const locationId = locationData.locationId || `loc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    if (locationData.locationId) {
      const existingLocation = await db.collection('locations').findOne({ 
        locationId: locationData.locationId 
      });

      if (existingLocation) {
        return sendConflict(res, 'Location with this locationId already exists');
      }
    }

    const defaultSettings = {
      allowDuplicateContact: locationData.settings?.allowDuplicateContact ?? false,
      allowDuplicateOpportunity: locationData.settings?.allowDuplicateOpportunity ?? false,
      allowFacebookNameMerge: locationData.settings?.allowFacebookNameMerge ?? true,
      disableContactTimezone: locationData.settings?.disableContactTimezone ?? false,
      contactUniqueIdentifiers: locationData.settings?.contactUniqueIdentifiers ?? ["email", "phone"],
      crmSettings: {
        deSyncOwners: locationData.settings?.crmSettings?.deSyncOwners ?? true,
        syncFollowers: {
          contact: locationData.settings?.crmSettings?.syncFollowers?.contact ?? true,
          opportunity: locationData.settings?.crmSettings?.syncFollowers?.opportunity ?? true
        },
        ...locationData.settings?.crmSettings
      },
      saasSettings: {
        saasMode: locationData.settings?.saasSettings?.saasMode ?? "not_activated",
        twilioRebilling: {
          enabled: locationData.settings?.saasSettings?.twilioRebilling?.enabled ?? false,
          markup: locationData.settings?.saasSettings?.twilioRebilling?.markup ?? 10
        },
        ...locationData.settings?.saasSettings
      },
      ...locationData.settings
    };

    const defaultSocial = {
      facebookUrl: locationData.social?.facebookUrl ?? "",
      googlePlus: locationData.social?.googlePlus ?? "",
      linkedIn: locationData.social?.linkedIn ?? "",
      foursquare: locationData.social?.foursquare ?? "",
      twitter: locationData.social?.twitter ?? "",
      yelp: locationData.social?.yelp ?? "",
      instagram: locationData.social?.instagram ?? "",
      youtube: locationData.social?.youtube ?? "",
      pinterest: locationData.social?.pinterest ?? "",
      blogRss: locationData.social?.blogRss ?? "",
      googlePlacesId: locationData.social?.googlePlacesId ?? "",
      ...locationData.social
    };

    const newLocation = {
      locationId: locationId,
      address: locationData.address || null,
      appInstalled: locationData.appInstalled ?? false,
      business: locationData.business || undefined,
      city: locationData.city || null,
      companyId: locationData.companyId || undefined,
      companyName: locationData.companyName,
      country: locationData.country || null,
      createdAt: new Date(),
      email: locationData.email,
      name: locationData.name || locationData.companyName,
      phone: locationData.phone,
      postalCode: locationData.postalCode || null,
      settings: defaultSettings,
      social: defaultSocial,
      state: locationData.state || null,
      timezone: locationData.timezone || null,
      updatedAt: new Date(),
      website: locationData.website || null,
      hasCompanyOAuth: locationData.hasCompanyOAuth ?? false,
      businessHours: locationData.businessHours || null,
      saaSPlanData: locationData.saaSPlanData ? {
        ...locationData.saaSPlanData,
        seatCount: locationData.saaSPlanData.baseSeats + locationData.saaSPlanData.additionalSeatCount
      } : undefined,
      lastWebhookUpdate: new Date(),
      processedBy: "onboard-api",
      webhookId: `onboard-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ...Object.fromEntries(
        Object.entries(locationData).filter(([key]) => 
          !['companyName', 'email', 'phone', 'locationId', 'name', 'address', 'city', 'state', 
            'country', 'postalCode', 'timezone', 'website', 'business', 'companyId', 'appInstalled',
            'hasCompanyOAuth', 'businessHours', 'settings', 'social', 'saaSPlanData'].includes(key)
        )
      )
    };

    const result = await db.collection('locations').insertOne(newLocation);

    return sendSuccess(res, {
      locationId: locationId,
      _id: result.insertedId,
      data: newLocation
    }, 'Location created successfully');

  } catch (error) {
    console.error('Error creating location:', error);
    return sendServerError(res, 'Failed to create location');
  }
}

async function getLocations(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const { 
      locationId, companyName, email, city, state, country, 
      appInstalled, limit = '50', page = '1' 
    } = req.query;
    
    let query: any = {};
    if (locationId) query.locationId = locationId;
    if (companyName) query.companyName = { $regex: companyName, $options: 'i' };
    if (email) query.email = email;
    if (city) query.city = city;
    if (state) query.state = state;
    if (country) query.country = country;
    if (appInstalled !== undefined) query.appInstalled = appInstalled === 'true';

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const locations = await db.collection('locations')
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .toArray();

    const total = await db.collection('locations').countDocuments(query);

    return sendSuccess(res, {
      locations,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    }, 'Locations retrieved successfully');

  } catch (error) {
    console.error('Error fetching locations:', error);
    return sendServerError(res, 'Failed to fetch locations');
  }
}

async function updateLocation(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const { locationId } = req.query;
    const updateData = req.body;

    if (!locationId) {
      return sendBadRequest(res, 'LocationId is required');
    }

    updateData.updatedAt = new Date();

    const result = await db.collection('locations').findOneAndUpdate(
      { locationId: locationId as string },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result?.value) {
      return sendNotFound(res, 'Location not found');
    }

    return sendSuccess(res, result.value, 'Location updated successfully');

  } catch (error) {
    console.error('Error updating location:', error);
    return sendServerError(res, 'Failed to update location');
  }
}

async function deleteLocation(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const { locationId } = req.query;

    if (!locationId) {
      return sendBadRequest(res, 'LocationId is required');
    }

    const result = await db.collection('locations').deleteOne({
      locationId: locationId as string
    });

    if (result.deletedCount === 0) {
      return sendNotFound(res, 'Location not found');
    }

    return sendSuccess(res, null, 'Location deleted successfully');

  } catch (error) {
    console.error('Error deleting location:', error);
    return sendServerError(res, 'Failed to delete location');
  }
} 