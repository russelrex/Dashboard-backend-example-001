import type { NextApiRequest, NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '@/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError, sendNotFound, sendPaginated } from '../../../src/utils/httpResponses';
import type { OnboardProgress, ProgressQuery } from '../../../src/types/onboarding';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  switch (req.method) {
    case 'GET':
      return await getProgress(req, res);
    case 'PUT':
      return await updateProgress(req, res);
    default:
      res.setHeader('Allow', ['GET', 'PUT']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function getProgress(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const {
      page = '1',
      limit = '20',
      locationId = '',
      currentPhase = '',
      overallProgress = ''
    }: ProgressQuery = req.query;

    if (locationId.trim()) {
      let progress = await db.collection('onboard_progress').findOne({ locationId: locationId.trim() });
      
      // If not found in onboard_progress, check locations.syncProgress
      if (!progress) {
        const location = await db.collection('locations').findOne({ locationId: locationId.trim() });
        if (location && location.syncProgress) {
          // Convert location syncProgress to expected format
          const completedSteps = Object.keys(location.syncProgress).filter(key => 
            location.syncProgress[key].status === 'complete'
          ).length;
          const totalSteps = Object.keys(location.syncProgress).length - 1; // Exclude 'overall'
          const overallProgress = Math.round((completedSteps / totalSteps) * 100);
          
          progress = {
            _id: new ObjectId(),
            locationId: locationId.trim(),
            overallProgress,
            currentPhase: Math.min(8, Math.floor(completedSteps / 2) + 1),
            phaseProgress: location.syncProgress,
            completedTaskIds: Object.keys(location.syncProgress).filter(key => 
              location.syncProgress[key].status === 'complete'
            ),
            lastUpdated: location.syncProgress.overall?.startedAt || new Date(),
            taskNotes: {}
          };
        }
      }
      
      if (!progress) {
        return sendNotFound(res, 'Progress record not found');
      }

      const clientInfo = await db.collection('onboard_clients').findOne({ locationId: locationId.trim() });

      const responseData = {
        progress,
        client: clientInfo || null
      };

      return sendSuccess(res, responseData, 'Progress retrieved successfully');
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const filter: any = {};

    if (currentPhase.trim()) {
      filter.currentPhase = parseInt(currentPhase.trim(), 10);
    }

    if (overallProgress.trim()) {
      const progressValue = parseInt(overallProgress.trim(), 10);
      filter.overallProgress = { $gte: progressValue };
    }

    const totalCount = await db.collection('onboard_progress').countDocuments(filter);
    
    const progressRecords = await db.collection('onboard_progress')
      .find(filter)
      .sort({ lastUpdated: -1 })
      .skip(skip)
      .limit(limitNum)
      .toArray();

    const enrichedRecords = await Promise.all(
      progressRecords.map(async (progress) => {
        const clientInfo = await db.collection('onboard_clients').findOne({ locationId: progress.locationId });
        return {
          ...progress,
          clientInfo: clientInfo ? {
            companyName: clientInfo.clientInfo?.companyName,
            contactPerson: clientInfo.clientInfo?.contactPerson,
            email: clientInfo.clientInfo?.email,
            packageType: clientInfo.packageType,
            status: clientInfo.status
          } : null
        };
      })
    );

    const responseData = {
      progress: enrichedRecords,
      filters: {
        currentPhase: currentPhase || null,
        overallProgress: overallProgress || null
      }
    };

    return sendPaginated(
      res,
      responseData.progress,
      {
        page: pageNum,
        limit: limitNum,
        total: totalCount
      },
      'Progress records retrieved successfully'
    );

  } catch (error) {
    console.error('Error fetching progress:', error);
    return sendServerError(res, error, 'Failed to fetch progress');
  }
}

async function updateProgress(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { locationId, taskId, action, userId, userName, notes, userType, userRole } = req.body;

    if (!locationId || !taskId) {
      return sendBadRequest(res, 'Missing required fields: locationId, taskId');
    }

    // If only notes are provided (no action), just log the note
    if (!action && notes) {
      const client = await clientPromise;
      const db = client.db(getDbName());

      const currentProgress = await db.collection('onboard_progress').findOne({ locationId });
      if (!currentProgress) {
        return sendNotFound(res, 'Progress record not found');
      }

      await logTaskAction(db, locationId, taskId, 'note-added', userId, userName, notes, userType, userRole);
      return sendSuccess(res, currentProgress, 'Note added to task successfully');
    }

    if (!action) {
      return sendBadRequest(res, 'Missing required field: action');
    }

    if (!['complete', 'uncomplete'].includes(action)) {
      return sendBadRequest(res, 'Action must be "complete" or "uncomplete"');
    }

    const taskIdRegex = /^P[1-5]_T\d{2}$/;
    if (!taskIdRegex.test(taskId)) {
      return sendBadRequest(res, 'Invalid task ID format. Must be P{1-5}_T{01-99}');
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    const currentProgress = await db.collection('onboard_progress').findOne({ locationId });
    if (!currentProgress) {
      return sendNotFound(res, 'Progress record not found');
    }

    const phaseId = taskId.charAt(1);
    
    let updatedProgress;
    if (action === 'complete') {
      updatedProgress = await completeTask(db, locationId, taskId, phaseId, currentProgress, userId, userName, notes, userType, userRole);
    } else {
      updatedProgress = await uncompleteTask(db, locationId, taskId, phaseId, currentProgress, userId, userName, notes, userType, userRole);
    }

    return sendSuccess(res, updatedProgress, `Task ${action}d successfully`);

  } catch (error) {
    console.error('Error updating progress:', error);
    return sendServerError(res, error, 'Failed to update progress');
  }
}

async function completeTask(
  db: any, 
  locationId: string, 
  taskId: string, 
  phaseId: string, 
  currentProgress: any, 
  userId?: string, 
  userName?: string, 
  notes?: string,
  userType?: string,
  userRole?: string
) {
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
    updatedAt: new Date(),
    userType,
    userRole
  };

  await db.collection('onboard_progress').updateOne(
    { locationId },
    { $set: updateData }
  );

  await logTaskAction(db, locationId, taskId, 'completed', userId, userName, notes, userType, userRole);

  return await db.collection('onboard_progress').findOne({ locationId });
}

async function uncompleteTask(
  db: any, 
  locationId: string,
  taskId: string,
  phaseId: string,
  currentProgress: any,
  userId?: string,
  userName?: string,
  notes?: string,
  userType?: string,
  userRole?: string
) {
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
    updatedAt: new Date(),
    userType,
    userRole
  };

  await db.collection('onboard_progress').updateOne(
    { locationId },
    { $set: updateData }
  );

  await logTaskAction(db, locationId, taskId, 'uncompleted', userId, userName, notes, userType, userRole);

  return await db.collection('onboard_progress').findOne({ locationId });
}

async function logTaskAction(
  db: any,
  locationId: string,
  taskId: string,
  action: string,
  userId?: string,
  userName?: string,
  notes?: string,
  userType?: string,
  userRole?: string) {
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
    updatedAt: new Date(),
    userType,
    userRole
  };

  await db.collection('onboard_task_logs').insertOne(logEntry);
} 