// pages/api/projects/byContact.ts
import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { contactId, locationId } = req.query;

  if (!contactId || typeof contactId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid contactId' });
  }

  if (!locationId || typeof locationId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid locationId' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Build query filter
    const filter: any = { 
      contactId,
      locationId // Multi-tenant security
    };

    // Optional: filter by status
    const { status } = req.query;
    if (status && typeof status === 'string') {
      filter.status = status;
    }

    const projects = await db
      .collection('projects')
      .find(filter)
      .sort({ createdAt: -1 }) // Most recent first
      .limit(100) // Reasonable limit
      .toArray();

    // Optional: Include pipeline names if available
    const location = await db.collection('locations').findOne({ locationId });
    if (location?.pipelines) {
      const pipelineMap = Object.fromEntries(
        location.pipelines.map((p: any) => [p.id, p.name])
      );
      
      // Add pipeline names to projects
      projects.forEach((project: any) => {
        if (project.pipelineId && pipelineMap[project.pipelineId]) {
          project.pipelineName = pipelineMap[project.pipelineId];
        }
      });
    }

    return res.status(200).json({
      success: true,
      count: projects.length,
      projects
    });
  } catch (error) {
    console.error('Error loading projects by contact:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}