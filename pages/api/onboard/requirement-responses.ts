import type { NextApiRequest, NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '@/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError, sendNotFound } from '../../../src/utils/httpResponses';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  switch (req.method) {
    case 'POST':
      return await submitResponse(req, res);
    case 'GET':
      return await getResponses(req, res);
    default:
      res.setHeader('Allow', ['POST', 'GET']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function submitResponse(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const { requirementId, responseData, notes, submittedBy } = req.body;
    
    if (!requirementId || !responseData) {
      return sendBadRequest(res, 'Missing required fields: requirementId and responseData are required');
    }

    if (!ObjectId.isValid(requirementId)) {
      return sendBadRequest(res, 'Invalid requirement ID format');
    }

    const requirement = await db.collection('onboard_task_requirements').findOne({
      _id: new ObjectId(requirementId)
    });
    
    if (!requirement) {
      return sendNotFound(res, 'Requirement not found');
    }

    const existingResponse = await db.collection('onboard_requirement_responses').findOne({
      requirementId: new ObjectId(requirementId)
    });
    
    if (existingResponse) {
      const result = await db.collection('onboard_requirement_responses').findOneAndUpdate(
        { requirementId: new ObjectId(requirementId) },
        {
          $set: {
            responseData,
            notes,
            status: 'submitted',
            submittedAt: new Date(),
            updatedAt: new Date()
          }
        },
        { returnDocument: 'after' }
      );
      
      await db.collection('onboard_task_requirements').updateOne(
        { _id: new ObjectId(requirementId) },
        { $set: { status: 'submitted', updatedAt: new Date() } }
      );
      
      return sendSuccess(res, result?.value, 'Response updated successfully');
    } else {
      const response = {
        requirementId: new ObjectId(requirementId),
        locationId: requirement.locationId || 'default-location',
        taskId: requirement.taskId,
        responseType: requirement.type,
        responseData,
        notes,
        status: 'submitted',
        submittedAt: new Date(),
        submittedBy: submittedBy || {
          userId: 'system',
          userName: 'System User',
          email: 'system@example.com'
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await db.collection('onboard_requirement_responses').insertOne(response);

      await db.collection('onboard_task_requirements').updateOne(
        { _id: new ObjectId(requirementId) },
        { $set: { status: 'submitted', updatedAt: new Date() } }
      );
      
      return sendSuccess(res, {
        _id: result.insertedId,
        ...response
      }, 'Response submitted successfully');
    }
  } catch (error) {
    console.error('Error submitting response:', error);
    return sendServerError(res, 'Failed to submit response');
  }
}

async function getResponses(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const { requirementId, locationId, taskId, status } = req.query;
    
    let query: any = {};
    
    if (requirementId) {
      if (!ObjectId.isValid(requirementId as string)) {
        return sendBadRequest(res, 'Invalid requirement ID format');
      }
      query.requirementId = new ObjectId(requirementId as string);
    }
    if (locationId) query.locationId = locationId;
    if (taskId) query.taskId = taskId;
    if (status) query.status = status;
    
    const responses = await db.collection('onboard_requirement_responses')
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();
    
    const responsesWithRequirements = await Promise.all(
      responses.map(async (response) => {
        const requirement = await db.collection('onboard_task_requirements').findOne({
          _id: response.requirementId
        });
        return {
          ...response,
          requirement
        };
      })
    );
    
    return sendSuccess(res, responsesWithRequirements, 'Responses retrieved successfully');
  } catch (error) {
    console.error('Error fetching responses:', error);
    return sendServerError(res, 'Failed to fetch responses');
  }
} 