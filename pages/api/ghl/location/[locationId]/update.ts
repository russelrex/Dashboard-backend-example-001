import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import cors from '@/lib/cors';
import { DynamicCreateLocationRequest } from '@/interfaces/locations';

interface UpdateLocationRequest extends Partial<DynamicCreateLocationRequest> {
  // All fields from DynamicCreateLocationRequest are optional for updates
}

interface UpdateLocationResponse {
  success: boolean;
  data: any;
  locationId: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  const { locationId } = req.query;

  if (!locationId || typeof locationId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid locationId' });
  }

  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed. Use PUT.' });
  }

  try {
    const updateData: UpdateLocationRequest = req.body;

    // Build GHL request body with only provided fields
    const ghlRequestBody: any = {};

    if (updateData.name !== undefined) ghlRequestBody.name = updateData.name;
    if (updateData.email !== undefined) ghlRequestBody.email = updateData.email;
    if (updateData.phone !== undefined) ghlRequestBody.phone = updateData.phone;
    if (updateData.companyId !== undefined) ghlRequestBody.companyId = updateData.companyId;
    if (updateData.address !== undefined) ghlRequestBody.address = updateData.address;
    if (updateData.city !== undefined) ghlRequestBody.city = updateData.city;
    if (updateData.state !== undefined) ghlRequestBody.state = updateData.state;
    if (updateData.country !== undefined) ghlRequestBody.country = updateData.country;
    if (updateData.postalCode !== undefined) ghlRequestBody.postalCode = updateData.postalCode;
    if (updateData.website !== undefined) ghlRequestBody.website = updateData.website;
    if (updateData.timezone !== undefined) ghlRequestBody.timezone = updateData.timezone;

    // Handle prospectInfo
    if (updateData.prospectInfo !== undefined) {
      ghlRequestBody.prospectInfo = {
        firstName: updateData.prospectInfo?.firstName || '',
        lastName: updateData.prospectInfo?.lastName || '',
        email: updateData.email || updateData.prospectInfo?.email || ''
      };
    }

    // Handle settings
    if (updateData.settings !== undefined) {
      ghlRequestBody.settings = {
        allowDuplicateContact: updateData.settings?.allowDuplicateContact ?? false,
        allowDuplicateOpportunity: updateData.settings?.allowDuplicateOpportunity ?? false,
        allowFacebookNameMerge: updateData.settings?.allowFacebookNameMerge ?? false,
        disableContactTimezone: updateData.settings?.disableContactTimezone ?? false,
        ...updateData.settings
      };
    }

    // Handle social
    if (updateData.social !== undefined) {
      ghlRequestBody.social = updateData.social;
    }

    // Handle twilio
    if (updateData.twilio !== undefined) {
      ghlRequestBody.twilio = updateData.twilio;
    }

    // Handle mailgun
    if (updateData.mailgun !== undefined) {
      ghlRequestBody.mailgun = updateData.mailgun;
    }

    // Handle snapshotId
    if (updateData.snapshotId !== undefined) {
      ghlRequestBody.snapshotId = updateData.snapshotId;
    }

    console.log(`[GHL LOCATION UPDATE] Updating location ${locationId} with data:`, ghlRequestBody);

    const ghlUrl = `https://services.leadconnectorhq.com/locations/${locationId}`;
    
    try {
      const ghlResponse = await axios.put(ghlUrl, ghlRequestBody, {
        headers: {
          Authorization: `Bearer ${process.env.GHL_PRIVATE_KEY_LOCATION_CREATE}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28',
          'Accept': 'application/json'
        }
      });

      console.log(`[GHL LOCATION UPDATE] Successfully updated location ${locationId}`);
      
      const response: UpdateLocationResponse = {
        success: true,
        data: ghlResponse.data,
        locationId
      };

      return res.status(200).json(response);

    } catch (ghlError: any) {
      console.error('[GHL LOCATION UPDATE] GHL API Error:', ghlError.response?.data || ghlError.message);
      
      const status = ghlError.response?.status || 500;
      const errorMessage = ghlError.response?.data?.message || ghlError.response?.data || ghlError.message;
      
      return res.status(status).json({
        error: 'Failed to update location',
        details: errorMessage,
        ghlError: ghlError.response?.data
      });
    }

  } catch (error: any) {
    console.error('[GHL LOCATION UPDATE] Unexpected error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}
