import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import cors from '@/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError, sendNotFound, sendPaginated } from '../../../../src/utils/httpResponses';

interface TaskLogsQuery {
  page?: string;
  limit?: string;
  locationId?: string;
  taskId?: string;
  action?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  switch (req.method) {
    case 'GET':
      return await getTaskLogs(req, res);
    default:
      res.setHeader('Allow', ['GET']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function getTaskLogs(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const {
      page = '1',
      limit = '50',
      locationId = '',
      taskId = '',
      action = '',
      userId = '',
      startDate = '',
      endDate = ''
    }: TaskLogsQuery = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const filter: any = {};

    if (locationId.trim()) {
      filter.locationId = locationId.trim();
    }

    if (taskId.trim()) {
      filter.taskId = taskId.trim();
    }

    if (action.trim()) {
      filter.action = action.trim();
    }

    if (userId.trim()) {
      filter.$or = [
        { userId: userId.trim() },
        { userName: { $regex: userId.trim(), $options: 'i' } }
      ];
    }

    if (startDate.trim() || endDate.trim()) {
      filter.timestamp = {};
      if (startDate.trim()) {
        filter.timestamp.$gte = new Date(startDate.trim());
      }
      if (endDate.trim()) {
        filter.timestamp.$lte = new Date(endDate.trim());
      }
    }

    const totalCount = await db.collection('onboard_task_logs').countDocuments(filter);
    
    const taskLogs = await db.collection('onboard_task_logs')
      .find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limitNum)
      .toArray();

    const locationIds = [...new Set(taskLogs.map(log => log.locationId))];
    const clientsInfo = await db.collection('onboard_clients')
      .find({ locationId: { $in: locationIds } })
      .toArray();

    const clientsMap = new Map();
    clientsInfo.forEach(client => {
      clientsMap.set(client.locationId, {
        companyName: client.clientInfo?.companyName,
        contactPerson: client.clientInfo?.contactPerson,
        packageType: client.packageType
      });
    });

    const enrichedLogs = taskLogs.map(log => ({
      ...log,
      clientInfo: clientsMap.get(log.locationId) || null
    }));

    const responseData = {
      taskLogs: enrichedLogs,
      filters: {
        locationId: locationId || null,
        taskId: taskId || null,
        action: action || null,
        userId: userId || null,
        startDate: startDate || null,
        endDate: endDate || null
      }
    };

    return sendPaginated(
      res,
      responseData.taskLogs,
      {
        page: pageNum,
        limit: limitNum,
        total: totalCount
      },
      'Task logs retrieved successfully'
    );

  } catch (error) {
    console.error('Error fetching task logs:', error);
    return sendServerError(res, error, 'Failed to fetch task logs');
  }
} 