import type { NextApiRequest, NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import cors from '@/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError, sendNotFound } from '../../../../src/utils/httpResponses';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  switch (req.method) {
    case 'PUT':
      return await updateRequirement(req, res);
    case 'DELETE':
      return await deleteRequirement(req, res);
    default:
      res.setHeader('Allow', ['PUT', 'DELETE']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function updateRequirement(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const { requirementId } = req.query;
    const updateData = req.body;
    
    if (!ObjectId.isValid(requirementId as string)) {
      return sendBadRequest(res, 'Invalid requirement ID format');
    }

    updateData.updatedAt = new Date();
    
    const result = await db.collection('onboard_task_requirements').findOneAndUpdate(
      { _id: new ObjectId(requirementId as string) },
      { $set: updateData },
      { returnDocument: 'after' }
    );
    
    if (!result?.value) {
      return sendNotFound(res, 'Requirement not found');
    }
    
    return sendSuccess(res, result.value, 'Requirement updated successfully');
  } catch (error) {
    console.error('Error updating requirement:', error);
    return sendServerError(res, 'Failed to update requirement');
  }
}

async function deleteRequirement(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const { requirementId } = req.query;
    
    if (!ObjectId.isValid(requirementId as string)) {
      return sendBadRequest(res, 'Invalid requirement ID format');
    }
    
    const result = await db.collection('onboard_task_requirements').deleteOne({
      _id: new ObjectId(requirementId as string)
    });
    
    if (result.deletedCount === 0) {
      return sendNotFound(res, 'Requirement not found');
    }
    
    return sendSuccess(res, null, 'Requirement deleted successfully');
  } catch (error) {
    console.error('Error deleting requirement:', error);
    return sendServerError(res, 'Failed to delete requirement');
  }
} 