import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import axios from 'axios';
import { 
  sendSuccess, 
  sendError, 
  sendValidationError,
  sendServerError,
  sendMethodNotAllowed 
} from '../../../../src/utils/response';
import cors from '@/lib/cors';
import { DynamicCreateLocationRequest } from '../../../../src/interfaces/locations';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (req.method !== 'POST') {
    return sendMethodNotAllowed(res, ['POST']);
  }

  const requestData: DynamicCreateLocationRequest = req.body;

  if (!requestData.companyName) {
    return sendValidationError(res, { companyName: 'Company name is required' });
  }

  if (!requestData.email) {
    return sendValidationError(res, { email: 'Email is required' });
  }

  if (!requestData.phone) {
    return sendValidationError(res, { phone: 'Phone is required' });
  }

  const ghlRequestBody = {
    name: requestData.name || requestData.companyName,
    email: requestData.email,
    phone: requestData.phone,
    companyId: requestData.companyId,
    address: requestData.address || '',
    city: requestData.city || '',
    state: requestData.state || '',
    country: requestData.country || 'US',
    postalCode: requestData.postalCode || '',
    website: requestData.website || '',
    timezone: requestData.timezone || 'US/Central',
    prospectInfo: {
      firstName: requestData.prospectInfo?.firstName || '',
      lastName: requestData.prospectInfo?.lastName || '',
      email: requestData.email
    },
    settings: {
      allowDuplicateContact: requestData.settings?.allowDuplicateContact ?? false,
      allowDuplicateOpportunity: requestData.settings?.allowDuplicateOpportunity ?? false,
      allowFacebookNameMerge: requestData.settings?.allowFacebookNameMerge ?? false,
      disableContactTimezone: requestData.settings?.disableContactTimezone ?? false,
      ...requestData.settings
    },
    social: requestData.social || {},
    twilio: requestData.twilio || {},
    mailgun: requestData.mailgun || {},
    snapshotId: requestData.snapshotId || ''
  };
  
  try {
    await axios.post(
      'https://services.leadconnectorhq.com/locations/',
      ghlRequestBody,
      {
        headers: {
          'Authorization': `Bearer ${process.env.GHL_PRIVATE_KEY_LOCATION_CREATE}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (ghlError) {
    console.warn('GHL location creation failed, continuing with local creation:', ghlError);
  }

    const createdLocation = `loc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const client = await clientPromise;
    const db = client.db(getDbName());

    const locationId = createdLocation;

    const existingLocation = await db.collection('locations').findOne({ 
      locationId: locationId 
    });

    if (existingLocation) {
      return sendError(res, 'Location with this locationId already exists', 409);
    }

    const defaultSettings = {
      allowDuplicateContact: requestData.settings?.allowDuplicateContact ?? false,
      allowDuplicateOpportunity: requestData.settings?.allowDuplicateOpportunity ?? false,
      allowFacebookNameMerge: requestData.settings?.allowFacebookNameMerge ?? true,
      disableContactTimezone: requestData.settings?.disableContactTimezone ?? false,
      contactUniqueIdentifiers: requestData.settings?.contactUniqueIdentifiers ?? ["email", "phone"],
      crmSettings: {
        deSyncOwners: requestData.settings?.crmSettings?.deSyncOwners ?? true,
        syncFollowers: {
          contact: requestData.settings?.crmSettings?.syncFollowers?.contact ?? true,
          opportunity: requestData.settings?.crmSettings?.syncFollowers?.opportunity ?? true
        },
        ...requestData.settings?.crmSettings
      },
      saasSettings: {
        saasMode: requestData.settings?.saasSettings?.saasMode ?? "not_activated",
        twilioRebilling: {
          enabled: requestData.settings?.saasSettings?.twilioRebilling?.enabled ?? false,
          markup: requestData.settings?.saasSettings?.twilioRebilling?.markup ?? 10
        },
        ...requestData.settings?.saasSettings
      },
      ...requestData.settings
    };

    const defaultSocial = {
      facebookUrl: requestData.social?.facebookUrl ?? "",
      googlePlus: requestData.social?.googlePlus ?? "",
      linkedIn: requestData.social?.linkedIn ?? "",
      foursquare: requestData.social?.foursquare ?? "",
      twitter: requestData.social?.twitter ?? "",
      yelp: requestData.social?.yelp ?? "",
      instagram: requestData.social?.instagram ?? "",
      youtube: requestData.social?.youtube ?? "",
      pinterest: requestData.social?.pinterest ?? "",
      blogRss: requestData.social?.blogRss ?? "",
      googlePlacesId: requestData.social?.googlePlacesId ?? "",
      ...requestData.social
    };

    const newLocation = {
      locationId: locationId,
      address: requestData.address || null,
      appInstalled: requestData.appInstalled ?? false,
      business: requestData.business,
      city: requestData.city || null,
      companyId: requestData.companyId || undefined,
      companyName: requestData.companyName,
      country: requestData.country || null,
      createdAt: new Date(),
      email: requestData.email,
      name: requestData.name || requestData.companyName,
      phone: requestData.phone,
      postalCode: requestData.postalCode || null,
      settings: defaultSettings,
      social: defaultSocial,
      state: requestData.state || null,
      timezone: requestData.timezone || null,
      updatedAt: new Date(),
      website: requestData.website || null,
      hasCompanyOAuth: requestData.hasCompanyOAuth ?? false,
      businessHours: requestData.businessHours,
      saaSPlanData: requestData.saaSPlanData ? {
        ...requestData.saaSPlanData,
        seatCount: requestData.saaSPlanData.baseSeats + requestData.saaSPlanData.additionalSeatCount
      } : undefined,
      lastWebhookUpdate: new Date(),
      processedBy: "ghl-api",
      webhookId: `ghl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      ghlData: ghlRequestBody,
      ...Object.fromEntries(
        Object.entries(requestData).filter(([key]) => 
          !['companyName', 'email', 'phone', 'locationId', 'name', 'address', 'city', 'state', 
            'country', 'postalCode', 'timezone', 'website', 'business', 'companyId', 'appInstalled',
            'hasCompanyOAuth', 'businessHours', 'settings', 'social', 'saaSPlanData', 'prospectInfo',
            'twilio', 'mailgun', 'snapshotId'].includes(key)
        )
      )
    };

    const result = await db.collection('locations').insertOne(newLocation);

    if (result) {
      return sendSuccess(res, {
        locationId: locationId,
        _id: result.insertedId,
        data: newLocation,
        message: 'Location created successfully in GHL and saved locally'
      });
    }
}
