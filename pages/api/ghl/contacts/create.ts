import type { NextApiRequest, NextApiResponse } from 'next';
import cors from '@/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError } from '../../../../src/utils/httpResponses';
import { sendMethodNotAllowed } from '@/utils/response';
import axios from 'axios';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import { CreateContactRequest, GHLContactResponse } from '../../../../src/interfaces/contacts';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'POST') {
    return sendMethodNotAllowed(res, ['POST']);
  }

  return await createGHLContact(req, res);
}

async function createGHLContact(req: NextApiRequest, res: NextApiResponse) {
  try {
    const contactData: CreateContactRequest = req.body;

    // Validate required field
    if (!contactData.locationId) {
      return sendBadRequest(res, 'locationId is required');
    }

    // Get OAuth token from locations collection
    const client = await clientPromise;
    const db = client.db(getDbName());

    const location = await db.collection('locations').findOne({ 
      locationId: contactData.locationId 
    });

    if (!location) {
      return sendBadRequest(res, 'Location not found');
    }

    const accessToken = location?.ghlOAuth?.accessToken;
    if (!accessToken) {
      console.warn(`⚠️ OAuth token missing for locationId: ${contactData.locationId}`);
      return sendBadRequest(res, 'OAuth token not found for this location');
    }

    console.log(`🔎 Creating GHL contact for locationId: ${contactData.locationId}`);
    console.log(`🔑 Using OAuth token: ${accessToken.slice(0, 20)}...`);

    // Prepare the request payload
    const requestPayload: any = {
      locationId: contactData.locationId,
    };

    // Add optional fields only if they are provided
    if (contactData.firstName !== undefined) requestPayload.firstName = contactData.firstName;
    if (contactData.lastName !== undefined) requestPayload.lastName = contactData.lastName;
    if (contactData.name !== undefined) requestPayload.name = contactData.name;
    if (contactData.email !== undefined) requestPayload.email = contactData.email;
    if (contactData.gender !== undefined) requestPayload.gender = contactData.gender;
    if (contactData.phone !== undefined) requestPayload.phone = contactData.phone;
    if (contactData.address1 !== undefined) requestPayload.address1 = contactData.address1;
    if (contactData.city !== undefined) requestPayload.city = contactData.city;
    if (contactData.state !== undefined) requestPayload.state = contactData.state;
    if (contactData.postalCode !== undefined) requestPayload.postalCode = contactData.postalCode;
    if (contactData.website !== undefined) requestPayload.website = contactData.website;
    if (contactData.timezone !== undefined) requestPayload.timezone = contactData.timezone;
    if (contactData.dnd !== undefined) requestPayload.dnd = contactData.dnd;
    if (contactData.dndSettings !== undefined) requestPayload.dndSettings = contactData.dndSettings;
    if (contactData.inboundDndSettings !== undefined) requestPayload.inboundDndSettings = contactData.inboundDndSettings;
    if (contactData.tags !== undefined) requestPayload.tags = contactData.tags;
    if (contactData.customFields !== undefined) requestPayload.customFields = contactData.customFields;
    if (contactData.source !== undefined) requestPayload.source = contactData.source;
    if (contactData.country !== undefined) requestPayload.country = contactData.country;
    if (contactData.companyName !== undefined) requestPayload.companyName = contactData.companyName;
    if (contactData.assignedTo !== undefined) requestPayload.assignedTo = contactData.assignedTo;

    // Make the API call to GHL
    const response = await axios.post<{ contact: GHLContactResponse }>(
      'https://services.leadconnectorhq.com/contacts/',
      requestPayload,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json'
        }
      }
    );

    const ghlContact = response.data.contact;
    console.log(`✅ Contact created in GHL with ID: ${ghlContact.id}`);

    // Optionally store the contact in local MongoDB
    const localContact = {
      ghlContactId: ghlContact.id,
      locationId: ghlContact.locationId,
      firstName: ghlContact.firstName || null,
      lastName: ghlContact.lastName || null,
      name: ghlContact.name || null,
      email: ghlContact.email || null,
      phone: ghlContact.phone || null,
      address: ghlContact.address1 || null,
      city: ghlContact.city || null,
      state: ghlContact.state || null,
      postalCode: ghlContact.postalCode || null,
      country: ghlContact.country || null,
      companyName: ghlContact.companyName || null,
      website: ghlContact.website || null,
      timezone: ghlContact.timezone || null,
      dnd: ghlContact.dnd || false,
      tags: ghlContact.tags || [],
      source: ghlContact.source || 'api',
      assignedTo: ghlContact.assignedTo || null,
      createdAt: ghlContact.dateAdded ? new Date(ghlContact.dateAdded) : new Date(),
      updatedAt: ghlContact.dateUpdated ? new Date(ghlContact.dateUpdated) : new Date(),
    };

    const localResult = await db.collection('contacts').insertOne(localContact);
    console.log(`✅ Contact stored locally with _id: ${localResult.insertedId}`);

    return sendSuccess(res, {
      ghlContact,
      localContact: {
        _id: localResult.insertedId,
        ghlContactId: ghlContact.id,
        email: localContact.email,
      },
      message: 'Contact created successfully in GoHighLevel and local database'
    });

  } catch (error: any) {
    console.error('[GHL Contact Create Error]', error);

    if (error.response?.data) {
      const ghlError = error.response.data;
      return sendServerError(res, `GHL API Error: ${ghlError.message || error.message}`, error.response.status || 500);
    }

    if (error.code === 'ECONNREFUSED') {
      return sendServerError(res, 'Unable to connect to GHL API', 'Connection refused');
    }

    if (error.response?.status === 400) {
      return sendBadRequest(res, error.response?.data?.message || 'Invalid request data');
    }

    if (error.response?.status === 401) {
      return sendServerError(res, 'Authentication failed with GHL API');
    }

    if (error.response?.status === 409) {
      return sendBadRequest(res, 'Contact already exists');
    }

    return sendServerError(res, 'Failed to create contact', error.message);
  }
}

