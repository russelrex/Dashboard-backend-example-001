import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import cors from '@/lib/cors';
import { sendBadRequest, sendServerError, sendNotFound, sendPaginated } from '../../../../src/utils/httpResponses';

interface TasksByLocationQuery {
  page?: string;
  limit?: string;
  phaseId?: string;
  status?: string;
  priority?: string;
  assignedTo?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  switch (req.method) {
    case 'GET':
      return await getTasksByLocation(req, res);
    default:
      res.setHeader('Allow', ['GET']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function getTasksByLocation(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { locationId } = req.query;
    const {
      page = '1',
      limit = '50',
      phaseId = '',
      status = '',
      priority = '',
      assignedTo = ''
    }: TasksByLocationQuery = req.query;

    if (!locationId || typeof locationId !== 'string' || !locationId.trim()) {
      return sendBadRequest(res, 'Missing or invalid locationId parameter');
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Check if location exists
    const locationExists = await db.collection('onboard_clients').findOne({ locationId: locationId.trim() });
    if (!locationExists) {
      return sendNotFound(res, 'Location not found');
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    // Build filter object
    const filter: any = {
      locationId: locationId.trim()
    };

    if (phaseId.trim()) {
      filter.phaseId = parseInt(phaseId.trim());
    }

    if (status.trim()) {
      filter.status = status.trim();
    }

    if (priority.trim()) {
      filter.priority = priority.trim();
    }

    if (assignedTo.trim()) {
      filter.assignedTo = { $in: [assignedTo.trim()] };
    }

    const totalCount = await db.collection('onboard_tasks').countDocuments(filter);
    
    const tasks = await db.collection('onboard_tasks')
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .toArray();

    // Get client info for enrichment
    const clientInfo = {
      companyName: locationExists.clientInfo?.companyName,
      contactPerson: locationExists.clientInfo?.contactPerson,
      packageType: locationExists.packageType
    };

    const enrichedTasks = tasks.map((task: any) => ({
      ...task,
      clientInfo
    }));

    const responseData = {
      tasks: enrichedTasks,
      locationInfo: {
        locationId: locationId.trim(),
        companyName: clientInfo.companyName,
        contactPerson: clientInfo.contactPerson,
        packageType: clientInfo.packageType
      },
      filters: {
        phaseId: phaseId || null,
        status: status || null,
        priority: priority || null,
        assignedTo: assignedTo || null
      }
    };

    return sendPaginated(
      res,
      responseData.tasks,
      {
        page: pageNum,
        limit: limitNum,
        total: totalCount
      },
      'Tasks retrieved successfully'
    );

  } catch (error) {
    console.error('Error fetching tasks by location:', error);
    return sendServerError(res, error, 'Failed to fetch tasks');
  }
}
