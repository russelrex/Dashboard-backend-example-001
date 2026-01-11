import type { NextApiRequest, NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '@/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError } from '../../../src/utils/httpResponses';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  return await getProgressWithRequirements(req, res);
}

async function getProgressWithRequirements(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const { locationId } = req.query;
    
    if (!locationId) {
      return sendBadRequest(res, 'Location ID is required');
    }

    const [progress, clientInfo, requirements, responses] = await Promise.all([
      db.collection('onboard_progress').findOne({ locationId }),
      db.collection('onboard_clients').findOne({ locationId }),
      db.collection('onboard_task_requirements').find({
        $or: [{ locationId }, { locationId: null }]
      }).toArray(),
      db.collection('onboard_requirement_responses').find({ locationId }).toArray()
    ]);

    const defaultProgress = {
      locationId,
      completedTaskIds: [],
      phaseProgress: {},
      overallProgress: 0,
      currentPhase: 1,
      lastUpdated: new Date().toISOString(),
      taskNotes: {},
      taskRequirements: {},
      requirementResponses: {}
    };

    const enrichedRequirements = requirements.map(req => {
      const response = responses.find(resp => 
        resp.requirementId.toString() === req._id.toString()
      );
      return {
        ...req,
        response
      };
    });

    const requirementsByTask = enrichedRequirements.reduce((acc, req) => {
      const taskId = (req as any).taskId;
      if (!taskId) return acc;
      if (!acc[taskId]) acc[taskId] = [];
      acc[taskId].push(req);
      return acc;
    }, {} as Record<string, any[]>);

    const responsesByRequirement = responses.reduce((acc, resp) => {
      acc[resp.requirementId.toString()] = resp;
      return acc;
    }, {} as Record<string, any>);

    return sendSuccess(res, {
      progress: progress || defaultProgress,
      client: clientInfo || null,
      requirements: enrichedRequirements,
      responses,
      requirementsByTask,
      responsesByRequirement
    }, 'Progress with requirements retrieved successfully');
  } catch (error) {
    console.error('Error fetching progress with requirements:', error);
    return sendServerError(res, 'Failed to fetch progress with requirements');
  }
} 