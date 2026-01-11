import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import axios from 'axios';
import { getAuthHeader } from '../../../src/utils/ghlAuth';
import { 
  paginate, 
  buildDateRangeFilter, 
  buildSearchFilter 
} from '../../../src/utils/pagination';
import { 
  parseQueryParams, 
  buildProjectFilter 
} from '../../../src/utils/filters';
import { 
  sendPaginatedSuccess, 
  sendSuccess, 
  sendError, 
  sendValidationError,
  sendServerError,
  sendMethodNotAllowed 
} from '../../../src/utils/response';
import cors from '@/lib/cors';
import { publishAblyEvent, publishAssignmentEvent } from '../../../src/utils/ably/publishEvent';
import ably from '@/lib/ably-server';
import { createAutomationTrigger, getAblyInstance, publishAblyEvent as publishAblyEventFromHelper } from '@/utils/automations/triggerHelper';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const client = await clientPromise;
  const db = client.db(getDbName());

  // GET: Return all projects for a location with filtering and pagination
  if (req.method === 'GET') {
    try {
      // Parse and validate query parameters - NOW SUPPORTS MULTIPLE PIPELINE IDS
      const params = parseQueryParams(req.query);
      
      if (!params.locationId) {
        return sendValidationError(res, { locationId: 'Missing locationId' });
      }

      // 🎯 UPDATED: Build filter with multiple pipeline support
      const filter = buildProjectFilter(params);
      filter.deletedAt = { $exists: false };
      
      // Handle contactId to support both ObjectId and string formats
      if (params.contactId) {
        const contactIdValue = params.contactId;
        if (ObjectId.isValid(contactIdValue)) {
          filter.contactId = { $in: [new ObjectId(contactIdValue), contactIdValue] };
        } else {
          filter.contactId = contactIdValue;
        }
      }
      
      // Debug logging for pipeline filtering
      if (params.pipelineId && process.env.NODE_ENV === 'development') {
        console.log('[Projects API] Pipeline filter applied:', {
          pipelineId: params.pipelineId,
          filterQuery: filter.pipelineId,
          isMultiple: Array.isArray(params.pipelineId)
        });
      }
      
      // Add date range filter
      const dateFilter = buildDateRangeFilter('createdAt', params.startDate, params.endDate);
      Object.assign(filter, dateFilter);
      
      // Add search filter
      if (params.search) {
        const searchFilter = buildSearchFilter(params.search, ['title', 'notes', 'scopeOfWork']);
        if (searchFilter.$or) {
          // Combine with existing filter
          if (filter.$or) {
            filter.$and = [{ $or: filter.$or }, searchFilter];
            delete filter.$or;
          } else {
            Object.assign(filter, searchFilter);
          }
        }
      }

      // Debug final filter
      if (process.env.NODE_ENV === 'development') {
        console.log('[Projects API] Final MongoDB filter:', JSON.stringify(filter, null, 2));
      }

      // Get paginated results
      const result = await paginate(
        db.collection('projects'),
        filter,
        {
          limit: params.limit,
          offset: params.offset,
          sortBy: params.sortBy,
          sortOrder: params.sortOrder
        }
      );

      // Debug results
      if (process.env.NODE_ENV === 'development') {
        console.log('[Projects API] ✅ Query results:', {
          totalFound: result.data.length,
          samplePipelineIds: result.data.slice(0, 3).map(p => p.pipelineId),
          pagination: result.pagination
        });
      }

      if (params.countOnly) {
        const countFilter = buildProjectFilter(params);
        countFilter.deletedAt = { $exists: false };
        
        // Handle contactId to support both ObjectId and string formats
        if (params.contactId) {
          const contactIdValue = params.contactId;
          if (ObjectId.isValid(contactIdValue)) {
            countFilter.contactId = { $in: [new ObjectId(contactIdValue), contactIdValue] };
          } else {
            countFilter.contactId = contactIdValue;
          }
        }
        
        if (params.startDate || params.endDate) {
          Object.assign(countFilter, buildDateRangeFilter('createdAt', params.startDate, params.endDate));
        }
      
        const total = await db.collection('projects').countDocuments(countFilter);
        return sendSuccess(res, { total }, 'Total projects count');
      }

      // Optionally enrich with contact info if requested
      if (params.includeContact === 'true') {
        const contactIds = result.data
          .map(p => p.contactId)
          .filter(Boolean)
          .filter(id => ObjectId.isValid(id));
          
        if (contactIds.length > 0) {
          const contacts = await db
            .collection('contacts')
            .find({ _id: { $in: contactIds.map(id => new ObjectId(id)) } })
            .toArray();

          // Map contact info to projects
          const contactMap = Object.fromEntries(
            contacts.map(c => [
              c._id.toString(),
              {
                name: `${c.firstName} ${c.lastName}`,
                email: c.email,
                phone: c.phone || '',
              },
            ])
          );

          // Attach contact info to each project
          result.data = result.data.map(p => ({
            ...p,
            contactName: contactMap[p.contactId?.toString()]?.name || '—',
            contactEmail: contactMap[p.contactId?.toString()]?.email || '',
            contactPhone: contactMap[p.contactId?.toString()]?.phone || '',
          }));
        }
      }

      return sendPaginatedSuccess(
        res, 
        result.data, 
        result.pagination, 
        'Projects retrieved successfully'
      );
      
    } catch (err) {
      console.error('❌ Failed to load projects:', err);
      return sendServerError(res, err, 'Failed to load projects');
    }
  }

  // POST: Create a new project (sync to GHL if possible)
  else if (req.method === 'POST') {
    try {
      const { contactId, userId, locationId, title, serviceType, status, assignedTo, ...rest } = req.body;
      
      if (!contactId || !userId || !locationId || !title) {
        return sendValidationError(res, {
          contactId: !contactId ? 'Required' : '',
          userId: !userId ? 'Required' : '',
          locationId: !locationId ? 'Required' : '',
          title: !title ? 'Required' : '',
        });
      }

      // Get contact details for GHL
      let mongoContact;
      try {
        mongoContact = await db.collection('contacts').findOne({ 
          _id: new ObjectId(contactId) 
        });
      } catch (error) {
        console.error('Contact ObjectId conversion error:', {
          value: contactId,
          type: typeof contactId,
          length: contactId?.length,
          error: error instanceof Error ? error.message : String(error)
        });
        return sendValidationError(res, { contactId: 'Invalid contact ID format' });
      }
      
      if (!mongoContact) {
        return sendValidationError(res, { contactId: 'Contact not found' });
      }

      const ghlContactId = mongoContact.ghlContactId;
      
      // Get location document for OAuth
      const locationDoc = await db.collection('locations').findOne({ locationId });
      
      if (!locationDoc) {
        return sendValidationError(res, { locationId: 'Location not found' });
      }

      // The frontend sends the selected pipelineId for this project:
      const pipelineId = rest.pipelineId;
      const pipelineName = rest.pipelineName;

      if (!pipelineId) {
        return sendValidationError(res, { pipelineId: 'Pipeline ID is required' });
      }

      // Log assignment logic for debugging
      console.log('🔧 Project Assignment Logic:', {
        passedAssignedTo: assignedTo,
        contactAssignedTo: mongoContact.assignedTo,
        currentUserId: userId,
        finalAssignedTo: assignedTo || mongoContact.assignedTo || userId
      });

      // Initialize project data with all fields
      const projectData = {
        contactId, 
        userId, 
        locationId, 
        title, 
        serviceType: serviceType?.trim() || '',
        status: 'open', // Always start as open
        monetaryValue: rest.monetaryValue || 0,
        pipelineId,
        pipelineName: pipelineName || null,
        ...rest, // Spread all other fields
        
        // EXPLICITLY add these fields for direct active job creation
        contractSigned: rest.contractSigned || false,
        contractSignedAt: rest.contractSignedAt || null,
        acceptedQuote: rest.acceptedQuote || null, // CRITICAL: Explicitly include this
        
        createdAt: new Date(),
        updatedAt: new Date(),
        // Add GHL fields that will be populated
        ghlContactId: ghlContactId || null,
        ghlOpportunityId: null,
        pipelineStageId: null,
        source: 'app',
      };

      // Fix 5A: Set default stage for Estimates pipeline if none specified
      if (!projectData.pipelineStageId && pipelineId === '9cGrqJIQlofiY1Ehj8xf') {
        projectData.pipelineStageId = 'b4d9e2ef-672c-4f3b-8440-f259ea968ae7'; // New Lead stage
        console.log('🔧 [Fix 5A] Set default stage for Estimates pipeline:', projectData.pipelineStageId);
      }

            // Convert MongoDB ObjectId to GHL user ID if needed
      let finalAssignedTo = userId; // Default to current user's GHL ID

      if (assignedTo) {
        // Check if it's a MongoDB ObjectId format (24 hex characters)
        if (/^[a-fA-F0-9]{24}$/.test(assignedTo)) {
          // Look up the user by MongoDB _id to get their GHL user ID
          try {
            const assignedUser = await db.collection('users').findOne({
              _id: new ObjectId(assignedTo)
            });
            if (assignedUser && assignedUser.ghlUserId) {
              finalAssignedTo = assignedUser.ghlUserId;
              console.log(`Converted MongoDB ID ${assignedTo} to GHL ID ${finalAssignedTo}`);
            } else {
              console.log(`Could not find GHL ID for MongoDB ID ${assignedTo}, using current user`);
            }
          } catch (error) {
            console.error('ObjectId conversion error in assignment resolution:', {
              value: assignedTo,
              type: typeof assignedTo,
              length: assignedTo?.length,
              error: error instanceof Error ? error.message : String(error)
            });
            console.log(`Failed to convert MongoDB ID ${assignedTo}, using current user`);
          }
        } else {
          // Already a GHL user ID - validate it exists
          const user = await db.collection('users').findOne({ ghlUserId: assignedTo });
          if (user) {
            finalAssignedTo = assignedTo;
            console.log(`Using existing GHL ID: ${finalAssignedTo}`);
          } else {
            console.log(`GHL user ID ${assignedTo} not found, using current user`);
          }
        }
      } else if (mongoContact.assignedTo) {
        finalAssignedTo = mongoContact.assignedTo;
      }

      projectData.assignedUserId = finalAssignedTo;
      
      // Add timeline
      projectData.timeline = [{
        id: new ObjectId().toString(),
        event: 'project_created',
        description: 'Project created from mobile app',
        timestamp: new Date(),
        userId,
        metadata: {
          source: 'mobile_app'
        }
      }];

      // 1️⃣ Save project in MongoDB first
      const result = await db.collection('projects').insertOne(projectData);
      const insertedId = result.insertedId;

      // 2️⃣ Try to create in GHL
      let ghlOpportunityData = null;
      
      try {
        if (ghlContactId && pipelineId) {
          // Use OAuth authentication
          const auth = await getAuthHeader(locationDoc);
          
          // Fix: Handle both MongoDB ObjectId and GHL user ID formats
          let assignedUser = null;
          if (assignedTo) {
            // Check if it's a MongoDB ObjectId format (24 hex characters)
            if (/^[a-fA-F0-9]{24}$/.test(assignedTo)) {
              try {
                assignedUser = await db.collection('users').findOne({ _id: new ObjectId(assignedTo) });
              } catch (error) {
                console.error('ObjectId conversion error in GHL sync:', {
                  value: assignedTo,
                  type: typeof assignedTo,
                  length: assignedTo?.length,
                  error: error instanceof Error ? error.message : String(error)
                });
                console.log(`Failed to convert MongoDB ID ${assignedTo} for GHL sync, skipping assignment`);
                assignedUser = null;
              }
            } else {
              // It's already a GHL user ID, look it up by ghlUserId
              assignedUser = await db.collection('users').findOne({ ghlUserId: assignedTo });
            }
          }
          
          const ghlPayload = {
            contactId: ghlContactId,
            pipelineId,
            locationId,
            status: 'open',
            name: title,
            monetaryValue: rest.monetaryValue || 0,
            assignedTo: assignedUser?.ghlUserId || undefined,
          };

          console.log('🚀 Creating GHL Opportunity with payload:', ghlPayload);

          const ghlRes = await axios.post(
            'https://services.leadconnectorhq.com/opportunities/',
            ghlPayload,
            {
              headers: {
                'Authorization': auth.header,
                'Content-Type': 'application/json',
                'Version': '2021-07-28',
              },
            }
          );

          ghlOpportunityData = ghlRes.data.opportunity;
          console.log('✅ GHL Opportunity created:', ghlOpportunityData?.id);

          // 3️⃣ Update MongoDB project with GHL data
          if (ghlOpportunityData?.id) {
            const updateData = {
              ghlOpportunityId: ghlOpportunityData.id,
              pipelineStageId: ghlOpportunityData.pipelineStageId || null,
              updatedAt: new Date(),
              // Add to timeline
              $push: {
                timeline: {
                  id: new ObjectId().toString(),
                  event: 'ghl_sync',
                  description: 'Synced with GoHighLevel',
                  timestamp: new Date(),
                  metadata: {
                    ghlOpportunityId: ghlOpportunityData.id,
                    pipelineStageId: ghlOpportunityData.pipelineStageId
                  }
                }
              }
            };

            await db.collection('projects').updateOne(
              { _id: insertedId },
              { 
                                 $set: {
                   ghlOpportunityId: ghlOpportunityData.id,
                   pipelineStageId: ghlOpportunityData.pipelineStageId || null,
                   assignedUserId: ghlOpportunityData.assignedTo || projectData.assignedUserId, // Keep our value if GHL doesn't return one
                   updatedAt: new Date()
                 },
                $push: {
                  timeline: {
                    id: new ObjectId().toString(),
                    event: 'ghl_sync',
                    description: 'Synced with GoHighLevel',
                    timestamp: new Date(),
                    metadata: {
                      ghlOpportunityId: ghlOpportunityData.id,
                      pipelineStageId: ghlOpportunityData.pipelineStageId
                    }
                  }
                }
              }
            );
          }
        } else {
          console.warn('⚠️ Missing GHL info (ghlContactId, pipelineId), created local project only');
        }
      } catch (err: any) {
        console.error('❌ Failed to sync opportunity with GHL:', err.response?.data || err.message);
        // Don't fail the whole request - project is still created in MongoDB
        // Add error to timeline
        await db.collection('projects').updateOne(
          { _id: insertedId },
          {
            $push: {
              timeline: {
                id: new ObjectId().toString(),
                event: 'ghl_sync_error',
                description: 'Failed to sync with GoHighLevel',
                timestamp: new Date(),
                metadata: {
                  error: err.response?.data?.message || err.message
                }
              }
            }
          }
        );
      }

      // 4️⃣ Fetch and return the complete project
      const createdProject = await db.collection('projects').findOne({ _id: insertedId });
      
      // 🔄 Create automation trigger for project creation
      console.log('🔄 Project created, creating automation trigger...');
      
              await createAutomationTrigger(db, {
          type: 'project-created',
          entityType: 'project',
          entityId: insertedId.toString(),
          locationId: projectData.locationId,
          stageId: projectData.pipelineStageId,
          pipelineId: projectData.pipelineId,
          data: {
            projectId: insertedId.toString(),
            contactId: projectData.contactId,
            projectName: projectData.title || projectData.name,
            monetaryValue: projectData.monetaryValue,
            assignedUserId: projectData.assignedUserId  // ADD THIS LINE
          }
        });

      // Publish real-time event
              await ably.channels.get(`user:${userId}`).publish('project-created', {
        project: createdProject,
        timestamp: new Date().toISOString()
      });
      
      // Publish Ably event for project creation
      await publishAblyEvent({
        locationId: locationId,
        userId: userId,
        entity: createdProject,
        eventType: 'project.created'
      });

      // Publish additional Ably event for project creation via helper
      const ablyInstance = getAblyInstance();
      await publishAblyEventFromHelper(ablyInstance, `location:${projectData.locationId}`, 'project.created', {
        projectId: insertedId.toString(),
        projectName: projectData.title || projectData.name,
        contactId: projectData.contactId,
        pipelineStageId: projectData.pipelineStageId
      });

      // Add contact info to response
      if (createdProject && mongoContact) {
        createdProject.contactName = `${mongoContact.firstName || ''} ${mongoContact.lastName || ''}`.trim();
        createdProject.contactEmail = mongoContact.email;
        createdProject.contactPhone = mongoContact.phone;
      }

      return sendSuccess(res, createdProject, 'Project created successfully');
      
    } catch (err) {
      console.error('❌ Failed to create project:', err);
      return sendServerError(res, err, 'Failed to create project');
    }
  }

  // Method not allowed
  else {
    return sendMethodNotAllowed(res, ['GET', 'POST']);
  }
}