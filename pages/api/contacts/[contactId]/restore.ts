// Example: Restore Contact Endpoint
// lpai-backend/pages/api/contacts/[contactId]/restore.ts

import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import { publishAblyEvent } from '../../../../src/utils/ably/publishEvent';
import axios from 'axios';
import { getAuthHeader } from '../../../../src/utils/ghlAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { contactId } = req.query;

  if (!contactId || typeof contactId !== 'string') {
    return res.status(400).json({ error: 'Invalid contact ID' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Find the deleted contact
    const contact = await db.collection('contacts').findOne({ 
      _id: new ObjectId(contactId),
      deletedAt: { $exists: true }
    });
    
    if (!contact) {
      return res.status(404).json({ error: 'Deleted contact not found' });
    }

    // Check if within 30 day window
    const deletedAt = new Date(contact.deletedAt);
    const now = new Date();
    const daysSinceDeleted = Math.floor((now.getTime() - deletedAt.getTime()) / (1000 * 60 * 60 * 1000));
    
    if (daysSinceDeleted > 30) {
      return res.status(400).json({ 
        error: 'Cannot restore - contact was deleted more than 30 days ago',
        deletedAt: contact.deletedAt,
        daysSinceDeleted
      });
    }

    const { includeProjects, includeQuotes } = req.query;
    
    // 1. Restore the contact in MongoDB
    await db.collection('contacts').updateOne(
      { _id: new ObjectId(contactId) },
      { 
        $unset: { 
          deletedAt: "",
          deletedBy: "",
          deletedReason: "",
          permanentDeleteDate: "",
          previousStatus: ""
        },
        $set: {
          status: contact.previousStatus || 'active',
          updatedAt: new Date()
        }
      }
    );

    // 2. Re-create in GHL if it was deleted there
    if (contact.ghlContactId) {
      const location = await db.collection('locations').findOne({ 
        locationId: contact.locationId 
      });
      
      if (location?.ghlOAuth?.accessToken) {
        try {
          const auth = await getAuthHeader(location);
          
          // First check if contact still exists in GHL
          try {
            await axios.get(
              `https://services.leadconnectorhq.com/contacts/${contact.ghlContactId}`,
              {
                headers: {
                  Authorization: auth.header,
                  Version: '2021-07-28',
                }
              }
            );
            console.log('✅ Contact still exists in GHL, no need to recreate');
          } catch (checkError: any) {
            if (checkError.response?.status === 404) {
              // Contact doesn't exist in GHL, recreate it
              console.log('🔄 Recreating contact in GHL...');
              
              const ghlPayload = {
                locationId: contact.locationId,
                firstName: contact.firstName,
                lastName: contact.lastName,
                email: contact.email,
                phone: contact.phone,
                address1: contact.address,
                companyName: contact.companyName,
                tags: contact.tags || [],
                source: 'restored',
                customField: [
                  {
                    key: 'restore_date',
                    field_value: new Date().toISOString()
                  }
                ]
              };

              const createResponse = await axios.post(
                'https://services.leadconnectorhq.com/contacts/',
                ghlPayload,
                {
                  headers: {
                    Authorization: auth.header,
                    Version: '2021-07-28',
                    'Content-Type': 'application/json'
                  }
                }
              );

              const newGhlContactId = createResponse.data.contact.id;
              
              // Update MongoDB with new GHL ID
              await db.collection('contacts').updateOne(
                { _id: new ObjectId(contactId) },
                { 
                  $set: { 
                    ghlContactId: newGhlContactId,
                    updatedAt: new Date()
                  }
                }
              );
              
              console.log('✅ Contact recreated in GHL with new ID:', newGhlContactId);
            }
          }
        } catch (ghlError: any) {
          console.error('⚠️ GHL sync failed during restore:', ghlError.response?.data || ghlError.message);
          // Don't fail the restore - contact is restored in MongoDB at least
        }
      }
    }

    // 3. Optionally restore related projects
    if (includeProjects === 'true') {
      const restoredProjects = await db.collection('projects').updateMany(
        { 
          contactId: contact._id.toString(),
          deletedAt: { $exists: true }
        },
        { 
          $unset: { 
            deletedAt: "",
            deletedBy: "",
            deletedReason: "",
            permanentDeleteDate: ""
          },
          $set: {
            status: 'open', // or use previousStatus if you stored it
            updatedAt: new Date()
          }
        }
      );
      
      // Re-create projects in GHL (as opportunities)
      if (restoredProjects.modifiedCount > 0) {
        const projects = await db.collection('projects').find({
          contactId: contact._id.toString()
        }).toArray();
        
        for (const project of projects) {
          if (project.ghlOpportunityId) {
            // Similar GHL recreation logic for opportunities
            // Check if exists, if not recreate
          }
        }
      }
    }

    // 4. Optionally restore related quotes
    if (includeQuotes === 'true') {
      await db.collection('quotes').updateMany(
        { 
          contactId: contact._id.toString(),
          deletedAt: { $exists: true }
        },
        { 
          $unset: { 
            deletedAt: "",
            deletedBy: "",
            deletedReason: "",
            permanentDeleteDate: ""
          },
          $set: {
            status: 'draft',
            updatedAt: new Date()
          }
        }
      );
    }

    // 5. Publish restore event
    await publishAblyEvent({
      locationId: contact.locationId,
      userId: req.headers['x-user-id'] as string || 'system',
      entity: contact,
      eventType: 'contact.restored'
    });

    // Fetch and return the restored contact
    const restoredContact = await db.collection('contacts').findOne({ 
      _id: new ObjectId(contactId) 
    });

    return res.status(200).json({ 
      success: true,
      contact: restoredContact,
      message: 'Contact restored successfully',
      restored: {
        projects: includeProjects === 'true',
        quotes: includeQuotes === 'true'
      }
    });

  } catch (error) {
    console.error('[Contact Restore] Error:', error);
    return res.status(500).json({ error: 'Failed to restore contact' });
  }
}

// Similar pattern for Project Restore:
// lpai-backend/pages/api/projects/[projectId]/restore.ts
// - Remove soft delete fields
// - Check if opportunity exists in GHL
// - If not, recreate it using the original project data
// - Update with new ghlOpportunityId if recreated