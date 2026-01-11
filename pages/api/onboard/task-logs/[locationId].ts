import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import cors from '@/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError, sendPaginated } from '../../../../src/utils/httpResponses';
import { ObjectId } from 'mongodb';

interface TaskLogsQuery {
  page?: string;
  limit?: string;
  taskId?: string;
  action?: string;
  userId?: string;
  userName?: string;
  startDate?: string;
  endDate?: string;
  userType?: string;
  userRole?: string;
  status?: string;
  includeDeleted?: string;
}

const toObjectId = (id: string | ObjectId) => {
  return typeof id === 'string' ? new ObjectId(id) : id;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  switch (req.method) {
    case 'GET':
      return await getTaskLogs(req, res);
    case 'PUT':
      return await updateTaskLog(req, res);
    default:
      res.setHeader('Allow', ['GET', 'PUT']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function updateTaskLog(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { locationId } = req.query;
    const { taskLogId, action, status, userId, notes } = req.body;

    if (!locationId || typeof locationId !== 'string' || !locationId.trim()) {
      return sendBadRequest(res, 'Missing or invalid locationId parameter');
    }

    if (!taskLogId) {
      return sendBadRequest(res, 'Missing taskLogId in request body');
    }

    if (!ObjectId.isValid(taskLogId)) {
      return sendBadRequest(res, 'Invalid taskLogId format');
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    const existingLog = await db.collection('onboard_task_logs').findOne({
      _id: toObjectId(taskLogId),
      locationId: locationId.trim()
    });

    if (!existingLog) {
      return res.status(404).json({ error: 'Task log not found or access denied' });
    }

    const updateData: any = {
      updatedAt: new Date()
    };

    if (action === 'soft_delete' || status === 'deleted') {
      updateData.status = 'deleted';
      updateData.deletedAt = new Date();
      if (userId) {
        updateData.deletedBy = userId;
      }
    } else if (action === 'update_note') {
      if (notes !== undefined) {
        updateData.notes = notes;
      }
      if (userId) {
        updateData.updatedBy = userId;
      }
    } else if (status) {
      updateData.status = status;
    }

    const result = await db.collection('onboard_task_logs').findOneAndUpdate(
      { 
        _id: toObjectId(taskLogId),
        locationId: locationId.trim()
      },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    return sendSuccess(res, result, 'Task log updated successfully');

  } catch (error) {
    console.error('Error updating task log:', error);
    return sendServerError(res, error, 'Failed to update task log');
  }
}

async function getTaskLogs(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { locationId } = req.query;
    const {
      page = '1',
      limit = '20',
      taskId,
      action,
      userId,
      userName,
      startDate,
      endDate,
      userType,
      userRole,
      status,
      includeDeleted = 'false'
    }: TaskLogsQuery = req.query;

    if (!locationId || typeof locationId !== 'string' || !locationId.trim()) {
      return sendBadRequest(res, 'Missing or invalid locationId parameter');
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const filter: any = {
      locationId: locationId.trim()
    };

    if (status && status.trim()) {
      if (status.trim() === 'active') {
        filter.$or = [
          { status: { $exists: false } },
          { status: 'active' },
          { status: null }
        ];
      } else {
        filter.status = status.trim();
      }
    } else if (includeDeleted !== 'true') {
      filter.$or = [
        { status: { $exists: false } },
        { status: { $ne: 'deleted' } },
        { status: null }
      ];
    }

    if (taskId && taskId.trim()) {
      filter.taskId = taskId.trim();
    }

    if (action && action.trim()) {
      filter.action = action.trim();
    }

    if (userId && userId.trim()) {
      filter.userId = userId.trim();
    }

    if (userName && userName.trim()) {
      filter.userName = { $regex: userName.trim(), $options: 'i' };
    }

    if (startDate || endDate) {
      filter.timestamp = {};
      
      if (startDate) {
        try {
          filter.timestamp.$gte = new Date(startDate);
        } catch (error) {
          return sendBadRequest(res, 'Invalid startDate format. Use ISO date string.');
        }
      }
      
      if (endDate) {
        try {
          filter.timestamp.$lte = new Date(endDate);
        } catch (error) {
          return sendBadRequest(res, 'Invalid endDate format. Use ISO date string.');
        }
      }
    }

    if (userType && userType.trim()) {
      filter.userType = userType.trim();
    }

    if (userRole && userRole.trim()) {
      filter.userRole = userRole.trim();
    }

    const totalCount = await db.collection('onboard_task_logs').countDocuments(filter);
    
    const taskLogs = await db.collection('onboard_task_logs')
      .find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limitNum)
      .toArray();

    const responseData = {
      logs: taskLogs,
      filters: {
        locationId,
        taskId: taskId || null,
        action: action || null,
        userId: userId || null,
        userName: userName || null,
        startDate: startDate || null,
        endDate: endDate || null,
        userType: userType || null,
        userRole: userRole || null,
        status: status || null,
        includeDeleted: includeDeleted === 'true'
      }
    };

    return sendPaginated(
      res,
      responseData.logs,
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
