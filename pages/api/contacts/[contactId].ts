// pages/api/contacts/[contactId].ts
// This file is used to handle the API requests for the contacts endpoint

import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import { getAuthHeader } from '@/utils/ghlAuth';
import axios from 'axios';
import { publishAblyEvent } from '../../../src/utils/ably/publishEvent';
import cors from '@/lib/cors';
import { triggerContactAutomation, getAblyInstance, publishAblyEvent as publishAblyEventFromHelper } from '@/utils/automations/triggerHelper';
import { verifyAuth } from '../../../src/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const { contactId } = req.query;

  if (!contactId || typeof contactId !== 'string') {
    return res.status(400).json({ error: 'Invalid contact ID' });
  }

  try {
    // Use centralized auth that checks for soft-deleted users
    const authUser = await verifyAuth(req);
  } catch (error: any) {
    return res.status(401).json({ error: error.message });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Create a reusable auth getter
    const getAuth = async (locationId: string) => {
      const locationDoc = await db.collection('locations').findOne({ locationId });
      const accessToken = locationDoc?.ghlOAuth?.accessToken;
      
      if (!accessToken) {
        return null;
      }
      
      return {
        header: `Bearer ${accessToken}`,
        token: accessToken
      };
    };

    // GET: Fetch contact details
    if (req.method === 'GET') {
      const contact = await db.collection('contacts').findOne({ 
        _id: new ObjectId(contactId),
        // Exclude soft-deleted contacts unless specifically requested
        ...(req.query.includeDeleted !== 'true' && { deletedAt: { $exists: false } })
      });

      if (!contact) {
        return res.status(404).json({ error: 'Contact not found' });
      }

      return res.status(200).json(contact);
    }

    // PATCH: Update contact
    if (req.method === 'PATCH') {
      try {
        const updates = req.body;
        
        // Get existing contact first
        const existingContact = await db.collection('contacts').findOne({ 
          _id: new ObjectId(contactId),
          deletedAt: { $exists: false } // Don't update deleted contacts
        });
        
        if (!existingContact) {
          return res.status(404).json({ error: 'Contact not found' });
        }

        const { _id, ...updateData } = updates;

        // Update MongoDB
        const result = await db.collection('contacts').updateOne(
          { _id: new ObjectId(contactId) },
          { 
            $set: { 
              ...updateData, 
              updatedAt: new Date() 
            } 
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: 'Contact not found' });
        }

        // Get updated contact
        const updated = await db.collection('contacts').findOne({ _id: new ObjectId(contactId) });

        // Publish Ably event for contact update
        await publishAblyEvent({
          locationId: updated.locationId,
          userId: req.headers['x-user-id'] as string,
          entity: updated,
          eventType: 'contact.updated'
        });

        // 🔄 Check for contact assignment changes and create automation triggers
        if (updateData.assignedTo && existingContact.assignedTo !== updateData.assignedTo) {
          await triggerContactAutomation(db, {
            contactId: contactId,
            locationId: existingContact.locationId,
            eventType: 'contact-assigned',
            assignedUserId: updateData.assignedTo,
            previousUserId: existingContact.assignedTo,
            contactName: existingContact.fullName || existingContact.name
          });
        }

        // 🔄 Check for tag changes and create automation triggers
        if (updateData.tags && existingContact.tags && 
            JSON.stringify(updateData.tags.sort()) !== JSON.stringify(existingContact.tags.sort())) {
          const tagsAdded = updateData.tags.filter((tag: string) => !existingContact.tags.includes(tag));
          const tagsRemoved = existingContact.tags.filter((tag: string) => !updateData.tags.includes(tag));
          
          if (tagsAdded.length > 0 || tagsRemoved.length > 0) {
            try {
              const { AutomationEventListener } = await import('../../../src/services/automationEventListener');
              const automationEventListener = new AutomationEventListener(db);
              await automationEventListener.emitContactTagged(updated, tagsAdded, tagsRemoved);
            } catch (error) {
              console.error('Failed to emit contact-tagged:', error);
            }
          }
        }

        // Publish additional Ably event for general contact updates
        const ably = getAblyInstance();
        await publishAblyEventFromHelper(ably, `location:${existingContact.locationId}`, 'contact.updated', {
          contactId: contactId,
          updatedFields: Object.keys(updateData),
          contact: { ...existingContact, ...updateData }
        });

        // Sync to GHL if we have the required data
        if (updated.ghlContactId && updated.locationId) {
          const auth = await getAuth(updated.locationId);
          
          if (auth) {
            const ghlHeaders = {
              'Authorization': auth.header,
              'Version': '2021-07-28',
              'Content-Type': 'application/json'
            };

            // Build GHL payload - only include fields that GHL accepts
            const ghlPayload: any = {};
            
            if (updateData.firstName !== undefined) ghlPayload.firstName = updateData.firstName;
            if (updateData.lastName !== undefined) ghlPayload.lastName = updateData.lastName;
            if (updateData.name !== undefined) ghlPayload.name = updateData.name;
            if (updateData.email !== undefined) ghlPayload.email = updateData.email;
            if (updateData.phone !== undefined) ghlPayload.phone = updateData.phone;
            if (updateData.address1 !== undefined) ghlPayload.address1 = updateData.address1;
            if (updateData.city !== undefined) ghlPayload.city = updateData.city;
            if (updateData.state !== undefined) ghlPayload.state = updateData.state;
            if (updateData.postalCode !== undefined) ghlPayload.postalCode = updateData.postalCode;
            if (updateData.website !== undefined) ghlPayload.website = updateData.website;
            if (updateData.timezone !== undefined) ghlPayload.timezone = updateData.timezone;
            if (updateData.dnd !== undefined) ghlPayload.dnd = updateData.dnd;
            if (updateData.dndSettings !== undefined) ghlPayload.dndSettings = updateData.dndSettings;
            if (updateData.tags !== undefined) ghlPayload.tags = updateData.tags;
            if (updateData.customFields !== undefined) ghlPayload.customFields = updateData.customFields;
            if (updateData.source !== undefined) ghlPayload.source = updateData.source;
            if (updateData.assignedTo !== undefined) {
              // Handle assignedTo field - convert MongoDB ObjectId to GHL User ID if needed
              if (updateData.assignedTo) {
                // Check if it's a MongoDB ObjectId pattern (24 hex characters)
                const isMongoId = /^[a-fA-F0-9]{24}$/.test(updateData.assignedTo);
                
                if (isMongoId) {
                  // Look up the user to get their GHL ID
                  const assignedUser = await db.collection('users').findOne({
                    _id: new ObjectId(updateData.assignedTo)
                  });
                  
                  if (assignedUser && assignedUser.ghlUserId) {
                    ghlPayload.assignedTo = assignedUser.ghlUserId;
                    console.log('📤 Converted assignedTo: MongoDB', updateData.assignedTo, '→ GHL', assignedUser.ghlUserId);
                  } else {
                    console.warn('⚠️ User not found or missing GHL ID:', updateData.assignedTo);
                    // Don't sync to GHL if we can't find the user
                    delete ghlPayload.assignedTo;
                  }
                } else {
                  // Assume it's already a GHL user ID
                  ghlPayload.assignedTo = updateData.assignedTo;
                }
              } else {
                // Handle null/empty assignment (unassign)
                ghlPayload.assignedTo = null;
              }
            }

            console.log('📤 Syncing contact update to GHL:', {
              contactId: updated.ghlContactId,
              updateFields: Object.keys(ghlPayload)
            });

            // Push changes to GHL (LeadConnector) API
            try {
              const ghlResponse = await axios.put(
                `https://services.leadconnectorhq.com/contacts/${updated.ghlContactId}`,
                ghlPayload,
                { headers: ghlHeaders }
              );
              console.log('✅ Contact synced to GHL:', updated.ghlContactId);
              console.log('GHL Response status:', ghlResponse.status);
            } catch (ghlError: any) {
              console.error('⚠️ GHL sync failed:', {
                status: ghlError.response?.status,
                message: ghlError.response?.data?.message || ghlError.message,
                data: ghlError.response?.data
              });
              // Don't fail the request - local update succeeded
              // Just log the sync failure
            }
          }
        }

        return res.status(200).json({ success: true, contact: updated });
      } catch (err) {
        console.error('❌ Failed to update contact:', err);
        return res.status(500).json({ error: 'Failed to update contact' });
      }
    }

    // DELETE: Soft delete contact with cascade options
    if (req.method === 'DELETE') {
      const session = await client.startSession();
      
      try {
        const { confirm, includeProjects, includeQuotes } = req.query;
        
        await session.withTransaction(async () => {
          const contact = await db.collection('contacts').findOne(
            { 
              _id: new ObjectId(contactId),
              deletedAt: { $exists: false }
            },
            { session }
          );
          
          if (!contact) {
            throw new Error('Contact not found');
          }

          const deletedBy = req.headers['x-user-id'] as string || 'system';
          const deletedAt = new Date();
          const permanentDeleteDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

          // If not confirmed, return preview of what will be deleted
          if (confirm !== 'true') {
            const [projects, quotes, notes, appointments, tasks, conversations] = await Promise.all([
              db.collection('projects').find({ 
                contactId: contact._id.toString(),
                status: { $ne: 'deleted' }
              }, { session }).toArray(),
              
              db.collection('quotes').find({ 
                contactId: contact._id.toString(),
                status: { $ne: 'deleted' }
              }, { session }).toArray(),
              
              db.collection('notes').find({
                contactId: contact._id.toString(),
                deletedAt: { $exists: false }
              }, { session }).toArray(),
              
              db.collection('appointments').find({
                contactId: contact._id.toString(),
                status: { $ne: 'deleted' }
              }, { session }).toArray(),
              
              db.collection('tasks').find({
                contactId: contact._id.toString(),
                deletedAt: { $exists: false }
              }, { session }).toArray(),
              
              db.collection('conversations').find({
                contactId: contact._id.toString(),
                deletedAt: { $exists: false }
              }, { session }).toArray()
            ]);
            
            const totalValue = [...projects, ...quotes].reduce((sum, item) => 
              sum + (item.monetaryValue || item.totalAmount || item.value || item.total || 0), 0
            );
            
            return res.status(200).json({
              requiresConfirmation: true,
              contact: {
                id: contact._id,
                name: contact.fullName || `${contact.firstName} ${contact.lastName}`.trim(),
                email: contact.email,
                phone: contact.phone
              },
              relatedData: {
                projects: {
                  count: projects.length,
                  items: projects.map(p => ({
                    id: p._id,
                    title: p.title,
                    value: p.monetaryValue || p.value || 0,
                    status: p.status
                  }))
                },
                quotes: {
                  count: quotes.length,
                  items: quotes.map(q => ({
                    id: q._id,
                    title: q.title,
                    total: q.totalAmount || q.total || 0,
                    status: q.status
                  }))
                },
                notes: notes.length,
                appointments: appointments.length,
                tasks: tasks.length,
                conversations: conversations.length
              },
              totalValue,
              message: projects.length > 0 || quotes.length > 0 
                ? 'This contact has active projects/quotes. Delete them too?'
                : 'Are you sure you want to delete this contact?'
            });
          }

          // Perform the actual deletion with cascades
          const updateOps = [];

          // 1. Soft delete the contact
          updateOps.push(
            db.collection('contacts').updateOne(
              { _id: contact._id },
              { 
                $set: { 
                  deletedAt,
                  deletedBy,
                  deletedReason: 'user_deleted',
                  permanentDeleteDate,
                  previousStatus: contact.status || 'active',
                  status: 'deleted'
                } 
              },
              { session }
            )
          );

          // 2. Handle projects based on user preference
          if (includeProjects === 'true') {
            // Soft delete projects
            updateOps.push(
              db.collection('projects').updateMany(
                { 
                  contactId: contact._id.toString(),
                  status: { $ne: 'deleted' }
                },
                { 
                  $set: { 
                    status: 'deleted',
                    deletedAt,
                    deletedBy,
                    deletedReason: 'contact_deleted',
                    permanentDeleteDate
                  } 
                },
                { session }
              )
            );
          } else {
            // Update projects to remove contact reference
            updateOps.push(
              db.collection('projects').updateMany(
                { contactId: contact._id.toString() },
                { 
                  $set: { 
                    contactId: null,
                    contactDeleted: true,
                    contactDeletedAt: deletedAt,
                    updatedAt: new Date()
                  } 
                },
                { session }
              )
            );
          }

          // 3. Handle quotes based on user preference
          if (includeQuotes === 'true') {
            // Soft delete quotes
            updateOps.push(
              db.collection('quotes').updateMany(
                { 
                  contactId: contact._id.toString(),
                  status: { $ne: 'deleted' }
                },
                { 
                  $set: { 
                    status: 'deleted',
                    deletedAt,
                    deletedBy,
                    deletedReason: 'contact_deleted',
                    permanentDeleteDate
                  } 
                },
                { session }
              )
            );
          } else {
            // Update quotes to remove contact reference
            updateOps.push(
              db.collection('quotes').updateMany(
                { contactId: contact._id.toString() },
                { 
                  $set: { 
                    contactId: null,
                    contactDeleted: true,
                    contactDeletedAt: deletedAt,
                    updatedAt: new Date()
                  } 
                },
                { session }
              )
            );
          }

          // 4. Always cascade delete related data
          updateOps.push(
            // Soft delete appointments
            db.collection('appointments').updateMany(
              { 
                contactId: contact._id.toString(),
                status: { $ne: 'deleted' }
              },
              { 
                $set: { 
                  status: 'deleted',
                  deletedAt,
                  deletedBy,
                  deletedReason: 'contact_deleted',
                  permanentDeleteDate
                } 
              },
              { session }
            ),
            
            // Soft delete notes
            db.collection('notes').updateMany(
              { 
                contactId: contact._id.toString(),
                deletedAt: { $exists: false }
              },
              { 
                $set: { 
                  deletedAt,
                  deletedBy,
                  deletedReason: 'contact_deleted',
                  permanentDeleteDate
                } 
              },
              { session }
            ),
            
            // Mark tasks as cancelled
            db.collection('tasks').updateMany(
              { 
                contactId: contact._id.toString(),
                status: { $ne: 'completed' }
              },
              { 
                $set: { 
                  status: 'cancelled',
                  cancelledAt: deletedAt,
                  cancelledBy: deletedBy,
                  cancelledReason: 'contact_deleted'
                } 
              },
              { session }
            ),
            
            // Mark conversations as archived
            db.collection('conversations').updateMany(
              { 
                contactId: contact._id.toString(),
                archived: { $ne: true }
              },
              { 
                $set: { 
                  archived: true,
                  archivedAt: deletedAt,
                  archivedBy: deletedBy,
                  archivedReason: 'contact_deleted'
                } 
              },
              { session }
            )
          );

          // Execute all operations
          await Promise.all(updateOps);

          // Publish Ably event for contact deletion
          await publishAblyEvent({
            locationId: contact.locationId,
            userId: deletedBy,
            entity: { 
              _id: contactId,
              deletedAt,
              cascaded: {
                projects: includeProjects === 'true',
                quotes: includeQuotes === 'true'
              }
            },
            eventType: 'contact.deleted'
          });

// Hard delete from GHL if available
if (contact.ghlContactId && contact.locationId) {
  const auth = await getAuth(contact.locationId);
  
  if (auth) {
    try {
      // HARD DELETE the contact from GHL
      await axios.delete(
        `https://services.leadconnectorhq.com/contacts/${contact.ghlContactId}`,
        {
          headers: {
            Authorization: auth.header,
            Version: '2021-07-28',
          }
        }
      );
      console.log('✅ Contact HARD DELETED from GHL:', contact.ghlContactId);
    } catch (ghlError: any) {
      console.error('⚠️ GHL delete failed:', ghlError.response?.data?.message || ghlError.message);
      // Don't fail the transaction - contact is soft deleted locally
    }
  }
}
        });

        await session.commitTransaction();
        
        return res.status(200).json({ 
          success: true,
          message: 'Contact deleted successfully',
          cascaded: {
            projects: includeProjects === 'true',
            quotes: includeQuotes === 'true'
          }
        });
        
      } catch (error: any) {
        await session.abortTransaction();
        console.error('❌ Failed to delete contact:', error);
        
        if (error.message === 'Contact not found') {
          return res.status(404).json({ error: 'Contact not found' });
        }
        
        return res.status(500).json({ 
          error: 'Failed to delete contact',
          message: error.message 
        });
      } finally {
        await session.endSession();
      }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error) {
    console.error('[Contact API] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}