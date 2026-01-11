import type { NextApiRequest, NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '@/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError, sendUnauthorized } from '../../../src/utils/httpResponses';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  switch (req.method) {
    case 'POST':
      return await createRequirement(req, res);
    case 'GET':
      return await getRequirements(req, res);
    default:
      res.setHeader('Allow', ['POST', 'GET']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function createRequirement(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const { taskId, title, description, type, priority, isRequired, dueDate, fileRequirement, textRequirement, locationId, agencyId, createdBy } = req.body;
    
    if (!taskId || !title || !description || !type || !priority) {
      return sendBadRequest(res, 'Missing required fields: taskId, title, description, type, priority are required');
    }

    if (type === 'text_input' && (!textRequirement?.question || !textRequirement.question.trim())) {
      return sendBadRequest(res, 'Question is required for text input requirements');
    }

    const requirement = {
      taskId,
      locationId: locationId || null,
      agencyId: agencyId || 'default-agency',
      title,
      description,
      type,
      priority,
      isRequired: Boolean(isRequired),
      dueDate: dueDate ? new Date(dueDate) : undefined,
      fileRequirement: type === 'file_upload' ? fileRequirement : undefined,
      textRequirement: type === 'text_input' ? textRequirement : undefined,
      status: 'pending',
      createdBy: createdBy || {
        userId: 'system',
        userName: 'System',
        role: 'agency_admin'
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('onboard_task_requirements').insertOne(requirement);
    
    return sendSuccess(res, {
      _id: result.insertedId,
      ...requirement
    }, 'Requirement created successfully');
  } catch (error) {
    console.error('Error creating requirement:', error);
    return sendServerError(res, 'Failed to create requirement');
  }
}

async function getRequirements(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const { taskId, locationId, agencyId, status, priority } = req.query;
    
    let query: any = {};
    
    if (taskId) query.taskId = taskId;
    if (locationId) {
      query.$or = [{ locationId }, { locationId: null }];
    }
    if (agencyId) query.agencyId = agencyId;
    if (status) query.status = status;
    if (priority) query.priority = priority;
    
    const requirements = await db.collection('onboard_task_requirements')
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();
    
    return sendSuccess(res, requirements, 'Requirements retrieved successfully');
  } catch (error) {
    console.error('Error fetching requirements:', error);
    return sendServerError(res, 'Failed to fetch requirements');
  }
} 