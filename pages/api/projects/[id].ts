/**
 * File: [id].ts
 * Purpose: Individual project CRUD operations with GHL sync
 * Author: LPai Team
 * Last Modified: 2025-09-03
 * Dependencies: axios, ghlAuth, mongodb
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import axios from 'axios';
import { getAuthHeader } from '../../../src/utils/ghlAuth';
import { 
  sendSuccess, 
  sendError, 
  sendValidationError,
  sendServerError,
  sendMethodNotAllowed,
  sendNotFound
} from '../../../src/utils/response';
import cors from '@/lib/cors';
import { publishAblyEvent } from '../../../src/utils/ably/publishEvent';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  const { id } = req.query;
  
  if (!id || typeof id !== 'string') {
    return sendValidationError(res, { id: 'Project ID is required' });
  }

  if (!ObjectId.isValid(id)) {
    return sendValidationError(res, { id: 'Invalid project ID format' });
  }

  const client = await clientPromise;
  const db = client.db(getDbName());

  try {
    if (req.method === 'GET') {
      // Get single project
      const project = await db.collection('projects').findOne({
        _id: new ObjectId(id),
        deletedAt: { $exists: false }
      });

      if (!project) {
        return sendNotFound(res, 'Project not found');
      }

      return sendSuccess(res, project, 'Project retrieved successfully');

    } else if (req.method === 'PUT') {
      // Update project
      const updates = req.body;
      updates.updatedAt = new Date();

      const result = await db.collection('projects').findOneAndUpdate(
        { _id: new ObjectId(id), deletedAt: { $exists: false } },
        { $set: updates },
        { returnDocument: 'after' }
      );

      if (!result.value) {
        return sendNotFound(res, 'Project not found');
      }

      // Publish real-time update
      try {
        await publishAblyEvent({
          locationId: result.value.locationId,
          userId: result.value.userId,
          entity: result.value,
          eventType: 'project.updated'
        });
      } catch (ablyError) {
        console.error('[Project API] Ably publish error:', ablyError);
      }

      return sendSuccess(res, result.value, 'Project updated successfully');

    } else if (req.method === 'PATCH') {
      // Handle all project updates - flexible approach
      const { locationId, ...updates } = req.body;
      
      // Get locationId from body or query params
      const projectLocationId = locationId || req.query.locationId;
      
      if (!projectLocationId) {
        return sendValidationError(res, { locationId: 'Location ID is required' });
      }
      
      // Prepare update data
      const updateData: any = { ...updates };
      updateData.updatedAt = new Date();
      
      // Handle timeline updates (append to existing timeline)
      if (updates.timeline && Array.isArray(updates.timeline)) {
        const result = await db.collection('projects').updateOne(
          { _id: new ObjectId(id), locationId: projectLocationId },
          {
            $push: {
              timeline: { $each: updates.timeline }
            },
            $set: {
              updatedAt: new Date()
            }
          }
        );
        
        if (result.matchedCount === 0) {
          return sendNotFound(res, 'Project not found');
        }
        
        return sendSuccess(res, { updated: true }, 'Project timeline updated successfully');
      }
      
      // Regular field updates
      const result = await db.collection('projects').updateOne(
        { _id: new ObjectId(id), locationId: projectLocationId },
        { $set: updateData }
      );
      
      if (result.matchedCount === 0) {
        return sendNotFound(res, 'Project not found');
      }
      
      // Get updated project for real-time publishing
      const updatedProject = await db.collection('projects').findOne({
        _id: new ObjectId(id)
      });
      
      // Sync to GHL if this is a stage update and project has ghlOpportunityId
      if (updates.pipelineStageId && updatedProject?.ghlOpportunityId) {
        try {
          console.log(`[Project API] Syncing stage change to GHL:`, {
            opportunityId: updatedProject.ghlOpportunityId,
            newStageId: updates.pipelineStageId,
            projectId: id
          });
          
          // Get location for authentication
          const location = await db.collection('locations').findOne({ 
            locationId: projectLocationId 
          });
          
          if (location) {
            const auth = await getAuthHeader(location);
            
            // Update opportunity stage in GHL
            const ghlPayload = {
              pipelineStageId: updates.pipelineStageId
            };
            
            const ghlResponse = await axios.put(
              `https://services.leadconnectorhq.com/opportunities/${updatedProject.ghlOpportunityId}`,
              ghlPayload,
              {
                headers: {
                  'Authorization': auth.header,
                  'Version': '2021-07-28',
                  'Content-Type': 'application/json'
                }
              }
            );
            
            console.log(`[Project API] GHL stage sync successful:`, {
              opportunityId: updatedProject.ghlOpportunityId,
              newStageId: updates.pipelineStageId,
              response: ghlResponse.data
            });
            
            // Add timeline entry for successful sync
            await db.collection('projects').updateOne(
              { _id: new ObjectId(id) },
              {
                $push: {
                  timeline: {
                    id: new ObjectId().toString(),
                    event: 'ghl_stage_synced',
                    description: `Stage synced to GoHighLevel: ${updates.pipelineStageId}`,
                    timestamp: new Date().toISOString(),
                    metadata: {
                      ghlOpportunityId: updatedProject.ghlOpportunityId,
                      newStageId: updates.pipelineStageId,
                      syncMethod: 'manual_update'
                    }
                  }
                }
              }
            );
            
          } else {
            console.warn(`[Project API] Location not found for GHL sync: ${projectLocationId}`);
          }
          
        } catch (ghlError: any) {
          console.error('[Project API] GHL stage sync failed:', {
            error: ghlError.message,
            response: ghlError.response?.data,
            status: ghlError.response?.status,
            opportunityId: updatedProject.ghlOpportunityId
          });
          
          // Add timeline entry for failed sync
          await db.collection('projects').updateOne(
            { _id: new ObjectId(id) },
            {
              $push: {
                timeline: {
                  id: new ObjectId().toString(),
                  event: 'ghl_sync_failed',
                  description: `Failed to sync stage to GoHighLevel: ${ghlError.message}`,
                  timestamp: new Date().toISOString(),
                  metadata: {
                    error: ghlError.message,
                    status: ghlError.response?.status,
                    ghlOpportunityId: updatedProject.ghlOpportunityId,
                    attemptedStageId: updates.pipelineStageId
                  }
                }
              }
            }
          );
          
          // Don't fail the whole operation - just log the sync failure
          console.log('[Project API] Continuing despite GHL sync failure');
        }
      }
      
      // Publish real-time update
      try {
        await publishAblyEvent({
          locationId: projectLocationId,
          userId: updates.userId || req.headers['x-user-id'],
          entity: updatedProject,
          eventType: 'project.updated'
        });
      } catch (ablyError) {
        console.error('[Project API] Ably publish error:', ablyError);
      }
      
      return sendSuccess(res, { updated: true, project: updatedProject }, 'Project updated successfully');

    } else if (req.method === 'DELETE') {
      // Delete project with GHL sync
      console.log(`[Project API] Deleting project: ${id}`);
      
      // First, get the project to check for GHL opportunity ID
      const project = await db.collection('projects').findOne({
        _id: new ObjectId(id),
        deletedAt: { $exists: false }
      });

      if (!project) {
        return sendNotFound(res, 'Project not found');
      }

      console.log(`[Project API] Found project with ghlOpportunityId: ${project.ghlOpportunityId}`);

      // If project has GHL opportunity ID, delete from GHL first
      if (project.ghlOpportunityId) {
        try {
          console.log(`[Project API] Deleting opportunity from GHL: ${project.ghlOpportunityId}`);
          
          // Get location details for authentication
          const location = await db.collection('locations').findOne({ 
            locationId: project.locationId 
          });

          if (location) {
            // Get authentication header
            const auth = await getAuthHeader(location);
            
            // Delete from GHL using axios pattern from your sample
            const options = {
              method: 'DELETE',
              url: `https://services.leadconnectorhq.com/opportunities/${project.ghlOpportunityId}`,
              headers: {
                Authorization: auth.header,
                Version: '2021-07-28',
                Accept: 'application/json'
              }
            };

            const { data } = await axios.request(options);
            console.log(`[Project API] GHL deletion successful:`, data);

            // Update project to remove GHL references
            await db.collection('projects').updateOne(
              { _id: new ObjectId(id) },
              { 
                $unset: { 
                  ghlOpportunityId: '',
                  ghlContactId: ''
                },
                $push: {
                  timeline: {
                    id: new ObjectId().toString(),
                    event: 'ghl_opportunity_deleted',
                    description: 'Opportunity deleted from GoHighLevel',
                    timestamp: new Date().toISOString(),
                    metadata: { 
                      deletedOpportunityId: project.ghlOpportunityId
                    }
                  }
                }
              }
            );
          } else {
            console.warn(`[Project API] Location not found for project, skipping GHL deletion`);
          }
        } catch (ghlError: any) {
          console.error('[Project API] Failed to delete from GHL:', ghlError.message);
          
          // Handle specific GHL errors
          if (ghlError.response?.status === 404) {
            console.log('[Project API] Opportunity already deleted in GHL, continuing with local deletion');
          } else if (ghlError.response?.status === 401) {
            console.error('[Project API] GHL authentication failed, continuing with local deletion');
          } else {
            console.error('[Project API] GHL deletion failed, continuing with local deletion');
          }
          
          // Continue with local deletion even if GHL deletion fails
        }
      }

      // Perform soft delete locally
      const result = await db.collection('projects').findOneAndUpdate(
        { _id: new ObjectId(id) },
        { 
          $set: {
            status: 'Deleted',
            deletedAt: new Date(),
            updatedAt: new Date()
          },
          $push: {
            timeline: {
              id: new ObjectId().toString(),
              event: 'project_deleted',
              description: 'Project deleted by user',
              timestamp: new Date().toISOString(),
              metadata: { 
                deletedBy: 'user',
                ghlSyncAttempted: !!project.ghlOpportunityId
              }
            }
          }
        },
        { returnDocument: 'after' }
      );

      if (!result.value) {
        return sendNotFound(res, 'Project not found');
      }

      // Publish real-time delete event
      try {
        await publishAblyEvent({
          locationId: result.value.locationId,
          userId: result.value.userId,
          entity: result.value,
          eventType: 'project.deleted'
        });
      } catch (ablyError) {
        console.error('[Project API] Ably publish error:', ablyError);
      }

      console.log(`[Project API] Project deletion completed: ${id}`);
      return sendSuccess(res, { deleted: true }, 'Project deleted successfully');

    } else {
      return sendMethodNotAllowed(res, ['GET', 'PUT', 'PATCH', 'DELETE']);
    }

  } catch (error: any) {
    console.error('[Project API] Handler error:', error);
    return sendServerError(res, error, 'Internal server error');
  }
}