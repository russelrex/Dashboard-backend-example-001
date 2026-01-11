import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import cors from '@/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError, sendNotFound, sendPaginated } from '../../../../src/utils/httpResponses';
import type { CompleteTaskRequest } from '../../../../src/types/onboarding';

interface CreateTaskRequest {
  locationId: string;
  phaseId: number;
  taskName: string;
  taskDescription?: string;
  estimatedDuration?: string;
  priority?: 'low' | 'medium' | 'high';
  assignedTo?: string[];
  userId?: string;
  userName?: string;
}

interface TaskQuery {
  page?: string;
  limit?: string;
  locationId?: string;
  phaseId?: string;
  status?: string;
  priority?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  switch (req.method) {
    case 'GET':
      return await getTasks(req, res);
    case 'POST':
      return await createTask(req, res);
    case 'PUT':
      return await completeTask(req, res);
    case 'DELETE':
      return await deleteTask(req, res);
    default:
      res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function getTasks(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const {
      page = '1',
      limit = '50',
      locationId = '',
      phaseId = '',
      status = '',
      priority = ''
    }: TaskQuery = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const filter: any = {};

    if (locationId.trim()) {
      filter.locationId = locationId.trim();
    }

    if (phaseId.trim()) {
      filter.phaseId = parseInt(phaseId.trim());
    }

    if (status.trim()) {
      filter.status = status.trim();
    }

    if (priority.trim()) {
      filter.priority = priority.trim();
    }


    const totalCount = await db.collection('onboard_tasks').countDocuments(filter);
    
    const tasks = await db.collection('onboard_tasks')
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .toArray();

    const locationIds = [...new Set(tasks.map((task: any) => task.locationId))];
    const clientsInfo = await db.collection('onboard_clients')
      .find({ locationId: { $in: locationIds } })
      .toArray();

    const clientsMap = new Map<string, { companyName?: string; contactPerson?: string; packageType?: string }>();
    clientsInfo.forEach((client: any) => {
      clientsMap.set(client.locationId, {
        companyName: client.clientInfo?.companyName,
        contactPerson: client.clientInfo?.contactPerson,
        packageType: client.packageType
      });
    });

    const enrichedTasks = tasks.map((task: any) => ({
      ...task,
      clientInfo: clientsMap.get(task.locationId) || null
    }));

    const responseData = {
      tasks: enrichedTasks,
      filters: {
        locationId: locationId || null,
        phaseId: phaseId || null,
        status: status || null,
        priority: priority || null
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
    console.error('Error fetching tasks:', error);
    return sendServerError(res, error, 'Failed to fetch tasks');
  }
}

async function createTask(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      locationId,
      phaseId,
      taskName,
      taskDescription,
      estimatedDuration,
      priority,
      assignedTo,
      userId,
      userName
    }: CreateTaskRequest = req.body;

    // Validation
    if (!locationId || !phaseId || !taskName) {
      return sendBadRequest(res, 'Missing required fields: locationId, phaseId, taskName');
    }

    if (phaseId < 1 || phaseId > 4) {
      return sendBadRequest(res, 'Phase ID must be between 1 and 4');
    }

    if (!['low', 'medium', 'high'].includes(priority || 'medium')) {
      return sendBadRequest(res, 'Priority must be low, medium, or high');
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Check if location exists
    const locationExists = await db.collection('onboard_clients').findOne({ locationId });
    if (!locationExists) {
      return sendNotFound(res, 'Location not found');
    }

    // Generate unique task ID
    const taskId = `TASK_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create task document
    const task = {
      taskId,
      locationId,
      phaseId: parseInt(phaseId.toString()),
      taskName: taskName.trim(),
      taskDescription: taskDescription?.trim() || '',
      estimatedDuration: estimatedDuration?.trim() || '',
      priority: priority || 'medium',
      assignedTo: assignedTo || [],
      status: 'pending',
      createdBy: {
        userId: userId || 'unknown',
        userName: userName || 'Unknown User'
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Insert into database
    await db.collection('onboard_tasks').insertOne(task);

    // Update phase progress
    await updatePhaseProgress(db, locationId, phaseId);

    const responseData = {
      taskId,
      taskName: task.taskName,
      phaseId: task.phaseId,
      locationId: task.locationId,
      createdAt: task.createdAt.toISOString()
    };

    return sendSuccess(res, responseData, 'Task created successfully');

  } catch (error) {
    console.error('Error creating task:', error);
    return sendServerError(res, error, 'Failed to create task');
  }
}

async function completeTask(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { locationId, taskId, userId, userName, notes, action = 'complete' }: CompleteTaskRequest & { action?: string } = req.body;

    if (!locationId || !taskId) {
      return sendBadRequest(res, 'Missing required fields: locationId, taskId');
    }

    const taskIdRegex = /^P[1-4]_T\d{2}$/;
    if (!taskIdRegex.test(taskId)) {
      return sendBadRequest(res, 'Invalid task ID format. Must be P{1-4}_T{01-99}');
    }

    if (!['complete', 'uncomplete'].includes(action)) {
      return sendBadRequest(res, 'Action must be "complete" or "uncomplete"');
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    const clientRecord = await db.collection('onboard_clients').findOne({ locationId });
    if (!clientRecord) {
      return sendNotFound(res, 'Client not found');
    }

    const progressRecord = await db.collection('onboard_progress').findOne({ locationId });
    if (!progressRecord) {
      return sendNotFound(res, 'Progress record not found');
    }

    const template = await db.collection('onboard_templates').findOne({ 
      packageType: clientRecord.packageType, 
      isActive: true 
    });

    let taskInfo = null;
    if (template) {
      const phaseId = parseInt(taskId.charAt(1));
      const phase = template.phases.find((p: any) => p.id === phaseId);
      if (phase) {
        taskInfo = phase.tasks.find((t: any) => t.id === taskId);
      }
    }

    const phaseId = taskId.charAt(1);
    
    let updatedProgress;
    if (action === 'complete') {
      updatedProgress = await completeTaskLogic(db, locationId, taskId, phaseId, progressRecord, userId, userName, notes);
    } else {
      updatedProgress = await uncompleteTaskLogic(db, locationId, taskId, phaseId, progressRecord, userId, userName, notes);
    }

    const responseData = {
      progress: updatedProgress,
      taskInfo: taskInfo || null,
      action,
      message: `Task ${taskId} ${action}d successfully`
    };

    return sendSuccess(res, responseData, `Task ${action}d successfully`);

  } catch (error: any) {
    console.error('Error completing task:', error);
    if (error.message === 'Task is already completed' || error.message === 'Task is not completed') {
      return sendBadRequest(res, error.message);
    }
    return sendServerError(res, error, 'Failed to update task');
  }
}

async function completeTaskLogic(db: any, locationId: string, taskId: string, phaseId: string, currentProgress: any, userId?: string, userName?: string, notes?: string) {
  if (currentProgress.completedTaskIds.includes(taskId)) {
    throw new Error('Task is already completed');
  }

  const updatedCompletedTasks = [...currentProgress.completedTaskIds, taskId];
  
  const phaseProgress = { ...currentProgress.phaseProgress };
  const currentPhaseProgress = phaseProgress[phaseId];
  
  if (currentPhaseProgress) {
    const newCompletedTasks = currentPhaseProgress.completedTasks + 1;
    const newPercentage = Math.round((newCompletedTasks / currentPhaseProgress.totalTasks) * 100);
    
    phaseProgress[phaseId] = {
      ...currentPhaseProgress,
      completedTasks: newCompletedTasks,
      percentage: newPercentage,
      status: newPercentage === 100 ? 'completed' : 'in_progress'
    };

    if (newCompletedTasks === 1 && !currentPhaseProgress.startDate) {
      phaseProgress[phaseId].startDate = new Date();
    }

    if (newPercentage === 100) {
      phaseProgress[phaseId].completionDate = new Date();
    }
  }

  const totalTasks = Object.values(phaseProgress).reduce((sum: number, phase: any) => sum + phase.totalTasks, 0);
  const totalCompleted = Object.values(phaseProgress).reduce((sum: number, phase: any) => sum + phase.completedTasks, 0);
  const overallProgress = Math.round((totalCompleted / totalTasks) * 100);

  let currentPhase = currentProgress.currentPhase;
  for (let i = 1; i <= 4; i++) {
    const phase = phaseProgress[i.toString()];
    if (phase && phase.status !== 'completed') {
      currentPhase = i;
      break;
    }
  }

  const milestones = [...currentProgress.milestones];
  const phaseJustCompleted = phaseProgress[phaseId]?.status === 'completed' && 
    !currentProgress.milestones.some((m: any) => m.phaseId === parseInt(phaseId));
  
  if (phaseJustCompleted) {
    milestones.push({
      phaseId: parseInt(phaseId),
      completedAt: new Date(),
      completedBy: userName || userId || 'Unknown'
    });
  }

  const updateData = {
    completedTaskIds: updatedCompletedTasks,
    phaseProgress,
    overallProgress,
    currentPhase,
    milestones,
    lastUpdated: new Date(),
    updatedBy: userName || userId || 'System',
    updatedAt: new Date()
  };

  await db.collection('onboard_progress').updateOne(
    { locationId },
    { $set: updateData }
  );

  await logTaskAction(db, locationId, taskId, 'completed', userId, userName, notes);

  return await db.collection('onboard_progress').findOne({ locationId });
}

async function uncompleteTaskLogic(db: any, locationId: string, taskId: string, phaseId: string, currentProgress: any, userId?: string, userName?: string, notes?: string) {
  if (!currentProgress.completedTaskIds.includes(taskId)) {
    throw new Error('Task is not completed');
  }

  const updatedCompletedTasks = currentProgress.completedTaskIds.filter((id: string) => id !== taskId);
  
  const phaseProgress = { ...currentProgress.phaseProgress };
  const currentPhaseProgress = phaseProgress[phaseId];
  
  if (currentPhaseProgress) {
    const newCompletedTasks = Math.max(0, currentPhaseProgress.completedTasks - 1);
    const newPercentage = Math.round((newCompletedTasks / currentPhaseProgress.totalTasks) * 100);
    
    phaseProgress[phaseId] = {
      ...currentPhaseProgress,
      completedTasks: newCompletedTasks,
      percentage: newPercentage,
      status: newPercentage === 0 ? 'pending' : newPercentage === 100 ? 'completed' : 'in_progress'
    };

    if (newPercentage < 100) {
      delete phaseProgress[phaseId].completionDate;
    }
  }

  const totalTasks = Object.values(phaseProgress).reduce((sum: number, phase: any) => sum + phase.totalTasks, 0);
  const totalCompleted = Object.values(phaseProgress).reduce((sum: number, phase: any) => sum + phase.completedTasks, 0);
  const overallProgress = Math.round((totalCompleted / totalTasks) * 100);

  let currentPhase = 1;
  for (let i = 1; i <= 4; i++) {
    const phase = phaseProgress[i.toString()];
    if (phase && phase.status !== 'completed') {
      currentPhase = i;
      break;
    }
  }

  const milestones = currentProgress.milestones.filter((m: any) => {
    if (m.phaseId === parseInt(phaseId)) {
      return phaseProgress[phaseId]?.status === 'completed';
    }
    return true;
  });

  const updateData = {
    completedTaskIds: updatedCompletedTasks,
    phaseProgress,
    overallProgress,
    currentPhase,
    milestones,
    lastUpdated: new Date(),
    updatedBy: userName || userId || 'System',
    updatedAt: new Date()
  };

  await db.collection('onboard_progress').updateOne(
    { locationId },
    { $set: updateData }
  );

  await logTaskAction(db, locationId, taskId, 'uncompleted', userId, userName, notes);

  return await db.collection('onboard_progress').findOne({ locationId });
}

async function logTaskAction(db: any, locationId: string, taskId: string, action: string, userId?: string, userName?: string, notes?: string) {
  const logEntry = {
    locationId,
    taskId,
    action,
    timestamp: new Date(),
    userId: userId || '',
    userName: userName || '',
    notes: notes || '',
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date()
  };

  await db.collection('onboard_task_logs').insertOne(logEntry);
}

async function updatePhaseProgress(db: any, locationId: string, phaseId: number) {
  try {
    // Get all tasks for this phase
    const tasks = await db.collection('onboard_tasks').find({
      locationId,
      phaseId: parseInt(phaseId.toString())
    }).toArray();

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((task: any) => task.status === 'completed').length;
    const percentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // Update progress in onboard_progress collection
    await db.collection('onboard_progress').updateOne(
      { locationId },
      {
        $set: {
          [`phaseProgress.${phaseId}`]: {
            completedTasks,
            totalTasks,
            percentage,
            status: percentage === 100 ? 'completed' : percentage > 0 ? 'in-progress' : 'pending'
          },
          lastUpdated: new Date()
        }
      },
      { upsert: true }
    );
  } catch (error) {
    console.error('Error updating phase progress:', error);
  }
}

async function deleteTask(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { locationId, taskId } = req.body;

    // Validation
    if (!locationId || !taskId) {
      return sendBadRequest(res, 'Missing required fields: locationId, taskId');
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Check if location exists
    const locationExists = await db.collection('onboard_clients').findOne({ locationId });
    if (!locationExists) {
      return sendNotFound(res, 'Location not found');
    }

    // Find the task to get its details before deletion
    const taskToDelete = await db.collection('onboard_tasks').findOne({ 
      locationId, 
      taskId 
    });

    if (!taskToDelete) {
      return sendNotFound(res, 'Task not found');
    }

    // Delete the task
    const deleteResult = await db.collection('onboard_tasks').deleteOne({ 
      locationId, 
      taskId 
    });

    if (deleteResult.deletedCount === 0) {
      return sendNotFound(res, 'Task not found or already deleted');
    }

    // Log the deletion action
    await logTaskAction(db, locationId, taskId, 'deleted', '', '', 'Task deleted');

    // Update phase progress after deletion
    await updatePhaseProgress(db, locationId, taskToDelete.phaseId);

    const responseData = {
      taskId,
      locationId,
      deletedAt: new Date().toISOString(),
      message: 'Task deleted successfully'
    };

    return sendSuccess(res, responseData, 'Task deleted successfully');

  } catch (error) {
    console.error('Error deleting task:', error);
    return sendServerError(res, error, 'Failed to delete task');
  }
} 