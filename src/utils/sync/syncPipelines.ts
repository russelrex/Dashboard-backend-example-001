// src/utils/sync/syncPipelines.ts
import axios from 'axios';
import { Db, ObjectId } from 'mongodb';
import { getAuthHeader } from '../ghlAuth';
import { publishAblyEvent } from '../ably/publishEvent';

export async function syncPipelines(db: Db, location: any) {
  const startTime = Date.now();
  console.log(`[Sync Pipelines] Starting for ${location.locationId}`);

  try {
    // Get auth header (OAuth or API key)
    const auth = await getAuthHeader(location);
    
    // Fetch pipelines from GHL
    const response = await axios.get(
      'https://services.leadconnectorhq.com/opportunities/pipelines',
      {
        headers: {
          'Authorization': auth.header,
          'Version': '2021-07-28',
          'Accept': 'application/json'
        },
        params: {
          locationId: location.locationId
        }
      }
    );

    const pipelines = response.data.pipelines || [];
    console.log(`[Sync Pipelines] Found ${pipelines.length} pipelines`);

    // Transform pipeline data to match our schema
    const transformedPipelines = pipelines.map((pipeline: any) => ({
      id: pipeline.id,
      name: pipeline.name,
      stages: (pipeline.stages || []).map((stage: any) => ({
        id: stage.id,
        name: stage.name,
        position: stage.position || 0,
        // Some versions include these fields
        showInFunnel: stage.showInFunnel !== undefined ? stage.showInFunnel : true,
        showInPieChart: stage.showInPieChart !== undefined ? stage.showInPieChart : true
      })).sort((a: any, b: any) => a.position - b.position),
      // Additional fields if available
      showInFunnel: pipeline.showInFunnel !== undefined ? pipeline.showInFunnel : true,
      showInPieChart: pipeline.showInPieChart !== undefined ? pipeline.showInPieChart : true
    }));

    // First, clean up pipeline records that no longer exist in GHL
    const currentPipelineIds = transformedPipelines.map(p => p.id);
    await db.collection('pipelines').deleteMany({
      locationId: location.locationId,
      ghlPipelineId: { $nin: currentPipelineIds }
    });
    console.log(`[Sync Pipelines] Cleaned up pipelines not in GHL`);

    // Check if pipelines have changed
    const existingPipelines = location.pipelines || [];
    const hasChanged = JSON.stringify(existingPipelines) !== JSON.stringify(transformedPipelines);

    // ALWAYS create/update individual pipeline records in pipelines collection
    for (const pipeline of transformedPipelines) {
      const pipelineRecord = {
        ghlPipelineId: pipeline.id,
        locationId: location.locationId,
        id: pipeline.id,
        name: pipeline.name,
        assignedTeams: [],
        assignedUsers: [],
        createdAt: new Date(),
        enableAutomation: true,
        enableStageProgression: false,
        isActive: true,
        isDefault: false,
        lastSyncedAt: new Date(),
        stages: pipeline.stages.map(stage => ({
          id: stage.id,
          name: stage.name,
          position: stage.position,
          color: '#007bff',
          isDefault: false,
          actions: [],
          automation: {},
          ghlStageId: stage.id,
          lastSyncedAt: new Date()
        })),
        syncedAt: new Date(),
        updatedAt: new Date(),
        visibility: 'everyone'
      };

      // Upsert pipeline record
      await db.collection('pipelines').updateOne(
        { locationId: location.locationId, ghlPipelineId: pipeline.id },
        { $set: pipelineRecord },
        { upsert: true }
      );
    }
    console.log(`[Sync Pipelines] Created/updated ${transformedPipelines.length} pipeline records`);

    let result;
    if (hasChanged) {
      // Update pipelines in database
      result = await db.collection('locations').updateOne(
        { _id: location._id },
        {
          $set: {
            pipelines: transformedPipelines,
            pipelinesUpdatedAt: new Date(),
            lastPipelineSync: new Date()
          }
        }
      );
      console.log(`[Sync Pipelines] Updated ${transformedPipelines.length} pipelines`);
    } else {
      // Just update sync timestamp
      result = await db.collection('locations').updateOne(
        { _id: location._id },
        {
          $set: {
            lastPipelineSync: new Date()
          }
        }
      );
      console.log(`[Sync Pipelines] No changes detected`);
    }

    const duration = Date.now() - startTime;
    console.log(`[Sync Pipelines] Completed in ${duration}ms`);

    // Publish Ably progress update
    try {
      await publishAblyEvent({
        locationId: location.locationId,
        entity: {
          locationId: location.locationId,
          syncProgress: {
            pipelines: {
              status: 'complete',
              pipelineCount: transformedPipelines.length,
              totalStages: transformedPipelines.reduce((sum: number, p: any) => sum + p.stages.length, 0),
              completedAt: new Date(),
              updated: hasChanged
            }
          }
        },
        eventType: 'progress-update',
        metadata: { stepName: 'Pipeline Sync' }
      });
    } catch (error) {
      console.error('[Ably] Failed to publish pipeline sync progress:', error);
    }

    // Return summary
    const pipelineSummary = transformedPipelines.map((p: any) => ({
      name: p.name,
      stageCount: p.stages.length
    }));

    return {
      updated: hasChanged,
      pipelineCount: transformedPipelines.length,
      pipelines: pipelineSummary,
      totalStages: transformedPipelines.reduce((sum: number, p: any) => sum + p.stages.length, 0),
      duration: `${duration}ms`
    };

  } catch (error: any) {
    console.error(`[Sync Pipelines] Error:`, error.response?.data || error.message);
    
    // Handle specific error cases
    if (error.response?.status === 404) {
      // No pipelines endpoint or not found
      console.log(`[Sync Pipelines] No pipelines found for location`);
      return {
        updated: false,
        pipelineCount: 0,
        pipelines: [],
        totalStages: 0,
        error: 'No pipelines found'
      };
    }
    
    if (error.response?.status === 401) {
      throw new Error('Authentication failed - invalid token or API key');
    }
    
    if (error.response?.status === 403) {
      throw new Error('Access denied - check permissions for pipelines');
    }
    
    throw error;
  }
}