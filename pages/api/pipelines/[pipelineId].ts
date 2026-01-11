// pages/api/pipelines/[pipelineId].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import { LocalPipeline, LocalPipelineStage } from '../../../../packages/types';
import jwt from 'jsonwebtoken';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Auth check at the beginning of the handler
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { method } = req;
    const { pipelineId } = req.query;

    if (!pipelineId || typeof pipelineId !== 'string') {
      return res.status(400).json({ error: 'pipelineId is required' });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    switch (method) {
      case 'GET':
        return await getPipeline(req, res, db, pipelineId, decoded);
      case 'PUT':
        return await updatePipeline(req, res, db, pipelineId, decoded);
      case 'DELETE':
        return await deletePipeline(req, res, db, pipelineId, decoded);
      default:
        res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
        return res.status(405).json({ error: `Method ${method} Not Allowed` });
    }
  } catch (error: any) {
    console.error('[PIPELINE API] Error:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
}

// Get a specific pipeline
async function getPipeline(req: NextApiRequest, res: NextApiResponse, db: any, pipelineId: string, decoded: any) {
  try {
    const pipeline = await db.collection('local_pipelines').findOne({ id: pipelineId });

    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }

    // Verify user has access to this pipeline's location
    if (decoded.locationId !== pipeline.locationId) {
      return res.status(403).json({ error: 'Access denied to this pipeline' });
    }

    return res.status(200).json({
      success: true,
      pipeline
    });
  } catch (error: any) {
    console.error('[PIPELINE API] Get error:', error);
    return res.status(500).json({ error: 'Failed to fetch pipeline' });
  }
}

// Update a pipeline
async function updatePipeline(req: NextApiRequest, res: NextApiResponse, db: any, pipelineId: string, decoded: any) {
  const { name, description, isActive, isDefault, stages } = req.body;

  try {
    const pipeline = await db.collection('local_pipelines').findOne({ id: pipelineId });
    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }

    // Verify user has access to this pipeline's location
    if (decoded.locationId !== pipeline.locationId) {
      return res.status(403).json({ error: 'Access denied to this pipeline' });
    }

    // Check if name is being changed and if it conflicts
    if (name && name !== pipeline.name) {
      const existingPipeline = await db.collection('local_pipelines').findOne({
        locationId: pipeline.locationId,
        name: { $regex: new RegExp(`^${name}$`, 'i') },
        id: { $ne: pipelineId }
      });

      if (existingPipeline) {
        return res.status(400).json({ error: 'Pipeline with this name already exists' });
      }
    }

    // If making this pipeline default, unset others
    if (isDefault) {
      await db.collection('local_pipelines').updateMany(
        { locationId: pipeline.locationId },
        { $set: { isDefault: false } }
      );
    }

    // Update pipeline
    const updateData: Partial<LocalPipeline> = {
      updatedAt: new Date()
    };

    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (isDefault !== undefined) updateData.isDefault = isDefault;
    if (stages !== undefined) updateData.stages = stages;

    const result = await db.collection('local_pipelines').updateOne(
      { id: pipelineId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }

    // Get updated pipeline
    const updatedPipeline = await db.collection('local_pipelines').findOne({ id: pipelineId });

    return res.status(200).json({
      success: true,
      pipeline: updatedPipeline
    });
  } catch (error: any) {
    console.error('[PIPELINE API] Update error:', error);
    return res.status(500).json({ error: 'Failed to update pipeline' });
  }
}

// Delete a pipeline
async function deletePipeline(req: NextApiRequest, res: NextApiResponse, db: any, pipelineId: string, decoded: any) {
  try {
    const pipeline = await db.collection('local_pipelines').findOne({ id: pipelineId });
    if (!pipeline) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }

    // Verify user has access to this pipeline's location
    if (decoded.locationId !== pipeline.locationId) {
      return res.status(403).json({ error: 'Access denied to this pipeline' });
    }

    // Check if this is the default pipeline
    if (pipeline.isDefault) {
      return res.status(400).json({ error: 'Cannot delete the default pipeline' });
    }

    // Check if pipeline is being used by any projects
    const projectCount = await db.collection('projects').countDocuments({
      locationId: pipeline.locationId,
      pipelineId: pipelineId
    });

    if (projectCount > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete pipeline that has projects',
        projectCount 
      });
    }

    // Delete the pipeline
    const result = await db.collection('local_pipelines').deleteOne({ id: pipelineId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Pipeline not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Pipeline deleted successfully'
    });
  } catch (error: any) {
    console.error('[PIPELINE API] Delete error:', error);
    return res.status(500).json({ error: 'Failed to delete pipeline' });
  }
} 