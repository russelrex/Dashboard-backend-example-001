import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { 
  paginate, 
  buildDateRangeFilter, 
  buildSearchFilter 
} from '../../../src/utils/pagination';
import { 
  parseQueryParams, 
  buildContactFilter 
} from '../../../src/utils/filters';
import { 
  sendPaginatedSuccess, 
  sendSuccess, 
  sendError, 
  sendValidationError,
  sendServerError,
  sendMethodNotAllowed 
} from '../../../src/utils/response';
import { GHL_ENDPOINTS } from '../../../constants/ghl';
import { getAuthHeader } from '@/utils/ghlAuth';
import { getLocation } from '../../../src/utils/getLocation';
import { publishAblyEvent } from '../../../src/utils/ably/publishEvent';
import { triggerContactAutomation } from '@/utils/automations/triggerHelper';

function formatPhoneToE164(phone: string): string {
  if (!phone) return '';
  const cleaned = phone.replace(/\D/g, '');

  if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (phone.startsWith('+')) return phone;

  return `+1${cleaned}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      return handleGetContacts(req, res);
    case 'POST':
      return handleCreateContact(req, res);
    default:
      return sendMethodNotAllowed(res, ['GET', 'POST']);
  }
}

async function handleGetContacts(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Parse and validate query parameters
    const params = parseQueryParams(req.query);
    
    if (!params.locationId) {
      return sendValidationError(res, { locationId: 'Missing locationId' });
    }

    // Build base filter
    const filter = buildContactFilter(params);
    filter.deletedAt = { $exists: false };

    
    // Add date range filter
    const dateFilter = buildDateRangeFilter('createdAt', params.startDate, params.endDate);
    Object.assign(filter, dateFilter);
    
    // Add search filter (search in name, email, phone)
    if (params.search) {
      const searchFilter = buildSearchFilter(params.search, [
        'firstName', 
        'lastName', 
        'email', 
        'phone',
        'companyName'
      ]);
      if (searchFilter.$or) {
        // Also search for full name
        searchFilter.$or.push({
          $expr: {
            $regexMatch: {
              input: { $concat: ['$firstName', ' ', '$lastName'] },
              regex: params.search,
              options: 'i'
            }
          }
        });
        
        if (filter.$or) {
          filter.$and = [{ $or: filter.$or }, searchFilter];
          delete filter.$or;
        } else {
          Object.assign(filter, searchFilter);
        }
      }
    }

    // Get paginated results
    const result = await paginate(
      db.collection('contacts'),
      filter,
      {
        limit: params.limit,
        offset: params.offset,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder
      }
    );

    // Optionally include project count if requested
    if (params.includeProjects === 'true') {
      const contactIds = result.data.map(c => c._id.toString());
      
      if (contactIds.length > 0) {
        // Get project counts for all contacts
        const projectCounts = await db.collection('projects').aggregate([
          {
            $match: {
              contactId: { $in: contactIds },
              status: { $ne: 'Deleted' }
            }
          },
          {
            $group: {
              _id: '$contactId',
              count: { $sum: 1 }
            }
          }
        ]).toArray();
        
        // Create a map of contact ID to project count
        const projectCountMap = Object.fromEntries(
          projectCounts.map(pc => [pc._id, pc.count])
        );
        
        // Add project count to each contact
        result.data = result.data.map(contact => ({
          ...contact,
          projectCount: projectCountMap[contact._id.toString()] || 0
        }));
      }
    }

    return sendPaginatedSuccess(
      res, 
      result.data, 
      result.pagination, 
      'Contacts retrieved successfully'
    );
    
  } catch (error) {
    console.error('❌ Failed to fetch contacts:', error);
    return sendServerError(res, error, 'Failed to fetch contacts');
  }
}

async function handleCreateContact(req: NextApiRequest, res: NextApiResponse) {
  try {
    const body = req.body;
    const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : null;

    if (!locationId) {
      return sendValidationError(res, { locationId: 'Missing locationId in query parameters' });
    }

    if (!body || !body.email) {
      return sendValidationError(res, { 
        email: !body?.email ? 'Email is required' : 'Email is required'
      });
    }

    if (body.phone) {
      body.phone = formatPhoneToE164(body.phone);
    }

    // Check for existing contact before creating
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const existingContact = await db.collection('contacts').findOne({
      locationId: locationId,
      $or: [
        { email: body.email },
        { phone: body.phone }
      ],
      deletedAt: { $exists: false }
    });

    if (existingContact) {
      // Contact already exists - return it with 409 status
      console.log('📋 Contact already exists:', existingContact._id);
      
      return res.status(409).json({
        success: false,
        isDuplicate: true,
        existingContact: {
          _id: existingContact._id,
          name: existingContact.fullName || `${existingContact.firstName} ${existingContact.lastName}`.trim(),
          email: existingContact.email,
          phone: existingContact.phone,
        },
        message: 'Contact already exists',
        error: 'A contact with this email or phone already exists'
      });
    }

    const location = await getLocation(locationId);
    const auth = await getAuthHeader(location);

    // Step 1: Create in GHL
    let ghlResponse;
    let ghlContact;
    
    try {
      ghlResponse = await axios.post(
        GHL_ENDPOINTS.CONTACTS.base,
        {
          ...body,
          locationId,
        },
        {
          headers: {
            Authorization: auth.header,
            'Content-Type': 'application/json',
            Version: '2021-07-28',
          },
        }
      );
      ghlContact = ghlResponse.data.contact;
    } catch (ghlError: any) {
      // Check if GHL returned a duplicate error
      if (ghlError.response?.status === 409 || ghlError.response?.data?.message?.includes('already exists')) {
        // Try to find the existing contact in GHL and sync it
        try {
          const searchResponse = await axios.get(
            `${GHL_ENDPOINTS.CONTACTS.base}?email=${encodeURIComponent(body.email)}`,
            {
              headers: {
                Authorization: auth.header,
                Version: '2021-07-28',
              },
            }
          );
          
          if (searchResponse.data.contacts && searchResponse.data.contacts.length > 0) {
            const existingGhlContact = searchResponse.data.contacts[0];
            
            // Create MongoDB entry for the existing GHL contact
            const mongoContact = {
              ghlContactId: existingGhlContact.id,
              locationId: locationId,
              firstName: existingGhlContact.firstName || '',
              lastName: existingGhlContact.lastName || '',
              fullName: existingGhlContact.contactName || `${existingGhlContact.firstName} ${existingGhlContact.lastName}`.trim(),
              email: existingGhlContact.email || '',
              phone: existingGhlContact.phone || '',
              secondaryPhone: existingGhlContact.additionalPhones?.[0] || '',
              address: existingGhlContact.address1 || '',
              city: existingGhlContact.city || '',
              state: existingGhlContact.state || '',
              country: existingGhlContact.country || 'US',
              postalCode: existingGhlContact.postalCode || '',
              companyName: existingGhlContact.companyName || '',
              website: existingGhlContact.website || '',
              dateOfBirth: existingGhlContact.dateOfBirth || null,
              tags: existingGhlContact.tags || [],
              source: existingGhlContact.source || body.source || '',
              type: existingGhlContact.type || 'lead',
              dnd: existingGhlContact.dnd || false,
              dndSettings: existingGhlContact.dndSettings || {},
              customFields: existingGhlContact.customFields || [],
              additionalEmails: existingGhlContact.additionalEmails || [],
              attributions: existingGhlContact.attributions || [],
              assignedUserId: existingGhlContact.assignedTo || null,
              ghlCreatedAt: new Date(existingGhlContact.dateAdded || Date.now()),
              ghlUpdatedAt: new Date(existingGhlContact.dateUpdated || Date.now()),
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            // Insert into MongoDB
            const result = await db.collection('contacts').insertOne(mongoContact);
            const createdContact = {
              _id: result.insertedId,
              ...mongoContact
            };

            return res.status(409).json({
              success: false,
              isDuplicate: true,
              existingContact: {
                _id: createdContact._id,
                name: createdContact.fullName || `${createdContact.firstName} ${createdContact.lastName}`.trim(),
                email: createdContact.email,
                phone: createdContact.phone,
              },
              message: 'Contact already exists - synced successfully',
              error: 'A contact with this email or phone already exists in GoHighLevel'
            });
          }
        } catch (searchError) {
          console.error('❌ Error searching for existing GHL contact:', searchError);
        }
      }
      
      // Re-throw the original error if we can't handle it
      throw ghlError;
    }

    // Step 2: Save to MongoDB
    // db already declared above
    
    const mongoContact = {
      ghlContactId: ghlContact.id,
      locationId: locationId,
      firstName: ghlContact.firstName || '',
      lastName: ghlContact.lastName || '',
      fullName: ghlContact.contactName || `${ghlContact.firstName} ${ghlContact.lastName}`.trim(),
      email: ghlContact.email || '',
      phone: ghlContact.phone || '',
      secondaryPhone: ghlContact.additionalPhones?.[0] || '',
      address: ghlContact.address1 || '',
      city: ghlContact.city || '',
      state: ghlContact.state || '',
      country: ghlContact.country || 'US',
      postalCode: ghlContact.postalCode || '',
      companyName: ghlContact.companyName || '',
      website: ghlContact.website || '',
      dateOfBirth: ghlContact.dateOfBirth || null,
      tags: ghlContact.tags || [],
      source: ghlContact.source || body.source || '',
      type: ghlContact.type || 'lead',
      dnd: ghlContact.dnd || false,
      dndSettings: ghlContact.dndSettings || {},
      customFields: ghlContact.customFields || [],
      additionalEmails: ghlContact.additionalEmails || [],
      attributions: ghlContact.attributions || [],
      assignedUserId: ghlContact.assignedTo || null,
      ghlCreatedAt: new Date(ghlContact.dateAdded || Date.now()),
      ghlUpdatedAt: new Date(ghlContact.dateUpdated || Date.now()),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Insert into MongoDB
    const result = await db.collection('contacts').insertOne(mongoContact);
    
    // Step 3: Return the MongoDB document with _id
    const createdContact = {
      _id: result.insertedId,
      ...mongoContact
    };
    // Publish Ably event for contact creation
    await publishAblyEvent({
      locationId: body.locationId,
      userId: body.userId || req.headers['x-user-id'] as string,
      entity: createdContact,
      eventType: 'contact.created'
    });

    // 🔄 Create automation trigger for contact creation
    await triggerContactAutomation(db, {
      contactId: result.insertedId.toString(),
      locationId: mongoContact.locationId,
      eventType: 'contact-created',
      assignedUserId: mongoContact.assignedUserId,
      contactName: mongoContact.fullName || `${mongoContact.firstName} ${mongoContact.lastName}`.trim()
    });

    return sendSuccess(res, {
      contact: ghlContact,  // GHL response for compatibility
      mongoContact: createdContact  // MongoDB document with _id
    }, 'Contact created successfully');
    
  } catch (error: any) {
    console.error('❌ Error creating contact:', error.response?.data || error.message);

    if (error?.response?.status === 401) {
      return sendError(res, 'Invalid or expired GHL token', 401);
    }

    return sendServerError(res, error, 'Failed to create contact');
  }
}