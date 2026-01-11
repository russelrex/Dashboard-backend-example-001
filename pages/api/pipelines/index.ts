// pages/api/pipelines/index.ts
import { NextApiRequest, NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import jwt from 'jsonwebtoken';


interface LocalPipelineStage {
  id: string;
  name: string;
  position: number;
  color: string;
  icon: string;
  isLocal: boolean;
  needsGHLSync: boolean;
  ghlStageId?: string | null;
}

interface LocalPipeline {
  _id?: ObjectId;
  id?: string;
  locationId: string;
  name: string;
  description?: string;
  stages: LocalPipelineStage[];
  isLocal: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

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

    const client = await clientPromise;
    const db = client.db(getDbName());

    if (req.method === 'GET') {
      const { locationId } = req.query;

      if (!locationId || typeof locationId !== 'string') {
        return res.status(400).json({ error: 'Location ID is required' });
      }

      // Verify user has access to this location
      if (decoded.locationId !== locationId) {
        return res.status(403).json({ error: 'Access denied to this location' });
      }

      try {
        // Get GHL pipelines from location document
        const location = await db.collection('locations').findOne(
          { locationId: locationId },
          { projection: { pipelines: 1 } }
        );

        const ghlPipelines = location?.pipelines || [];

        // Get local pipelines from local_pipelines collection
        const localPipelines = await db.collection('local_pipelines')
          .find({ locationId })
          .toArray();

        return res.status(200).json({
          success: true,
          localPipelines: localPipelines,
          ghlPipelines: ghlPipelines
        });

      } catch (error) {
        console.error('Error fetching pipelines:', error);
        return res.status(500).json({ error: 'Failed to fetch pipelines' });
      }

    } else if (req.method === 'POST') {
      const { locationId, name, description, stages } = req.body;

      if (!locationId || !name || !stages) {
        return res.status(400).json({ 
          error: 'Location ID, name, and stages are required' 
        });
      }

      // Verify user has access to this location
      if (decoded.locationId !== locationId) {
        return res.status(403).json({ error: 'Access denied to this location' });
      }

      try {
        const now = new Date();
        
        const pipelineId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const newPipeline: LocalPipeline = {
          id: pipelineId,
          locationId,
          name: name.trim(),
          description: description?.trim(),
          stages: stages.map((stage: any, index: number) => ({
            id: stage.id || `stage_${Date.now()}_${index}`,
            name: stage.name,
            position: stage.position || index,
            color: stage.color || '#3498DB',
            icon: stage.icon || 'ellipse',
            isLocal: true,
            needsGHLSync: true,
            ghlStageId: null
          })),
          isLocal: true,
          isActive: true,
          createdAt: now,
          updatedAt: now
        };

        const result = await db.collection('local_pipelines').insertOne(newPipeline);
        
        const createdPipeline = {
          ...newPipeline,
          _id: result.insertedId
        };

        return res.status(201).json({
          success: true,
          pipeline: createdPipeline
        });

      } catch (error) {
        console.error('Error creating pipeline:', error);
        return res.status(500).json({ error: 'Failed to create pipeline' });
      }

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Pipeline API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
} 