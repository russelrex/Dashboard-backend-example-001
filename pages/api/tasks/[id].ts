import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import { triggerTaskAutomation } from '@/utils/automations/triggerHelper';
import { publishAblyEvent } from '../../../src/utils/ably/publishEvent';
import { 
  sendSuccess, 
  sendError, 
  sendValidationError,
  sendServerError,
  sendMethodNotAllowed 
} from '../../../src/utils/response';
import cors from '@/lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const client = await clientPromise;
  const db = client.db(getDbName());
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return sendValidationError(res, { id: 'Missing or invalid task id' });
  }

  switch (req.method) {
    case 'GET':
      return await getTask(db, id, res);
    case 'PATCH':
    case 'PUT':
      return await updateTask(db, id, req.body, res);
    default:
      return sendMethodNotAllowed(res, ['GET', 'PATCH', 'PUT']);
  }
}

// 📋 GET: Fetch individual task
async function getTask(db: any, taskId: string, res: NextApiResponse) {
  try {
    if (!ObjectId.isValid(taskId)) {
      return sendValidationError(res, { id: 'Invalid task ID format' });
    }

    const task = await db.collection('tasks').findOne({ _id: new ObjectId(taskId) });
    
    if (!task) {
      return sendError(res, 'Task not found', 404);
    }

    return sendSuccess(res, task, 'Task retrieved successfully');
  } catch (err) {
    console.error('❌ Failed to fetch task:', err);
    return sendServerError(res, err, 'Failed to fetch task');
  }
}

// ✏️ PATCH/PUT: Update task
async function updateTask(db: any, taskId: string, updateData: any, res: NextApiResponse) {
  try {
    if (!ObjectId.isValid(taskId)) {
      return sendValidationError(res, { id: 'Invalid task ID format' });
    }

    // Get existing task
    const existingTask = await db.collection('tasks').findOne({ _id: new ObjectId(taskId) });
    
    if (!existingTask) {
      return sendError(res, 'Task not found', 404);
    }

    // Prepare update fields
    const updateFields: any = {
      ...updateData,
      updatedAt: new Date()
    };

    // Handle completion status
    if (updateData.completed !== undefined) {
      if (updateData.completed === true && !existingTask.completed) {
        updateFields.completedAt = new Date();
      } else if (updateData.completed === false) {
        updateFields.completedAt = null;
      }
    }

    // Update task in database
    const result = await db.collection('tasks').updateOne(
      { _id: new ObjectId(taskId) },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return sendError(res, 'Task not found', 404);
    }

    // Get updated task for events
    const updatedTask = await db.collection('tasks').findOne({ _id: new ObjectId(taskId) });

    // 🔄 Create automation triggers for task updates
    if (updateData.completed === true && !existingTask.completed) {
      await triggerTaskAutomation(db, {
        taskId: taskId,
        locationId: existingTask.locationId,
        eventType: 'task-completed',
        assignedTo: existingTask.assignedTo,
        contactId: existingTask.contactId,
        projectId: existingTask.projectId,
        title: existingTask.title
      });
    }

    if (updateData.assignedTo && existingTask.assignedTo !== updateData.assignedTo) {
      await triggerTaskAutomation(db, {
        taskId: taskId,
        locationId: existingTask.locationId,
        eventType: 'task-assigned',
        assignedTo: updateData.assignedTo,
        contactId: existingTask.contactId,
        projectId: existingTask.projectId,
        title: existingTask.title
      });
    }

    // Publish Ably event for task update
    await publishAblyEvent({
      locationId: existingTask.locationId,
      userId: req.headers['x-user-id'] as string || existingTask.assignedTo,
      entity: updatedTask,
      eventType: 'task.updated'
    });

    // Publish specific events based on what changed
    if (updateData.completed === true && !existingTask.completed) {
      await publishAblyEvent({
        locationId: existingTask.locationId,
        userId: req.headers['x-user-id'] as string || existingTask.assignedTo,
        entity: updatedTask,
        eventType: 'task.completed'
      });
    }

    if (updateData.assignedTo && existingTask.assignedTo !== updateData.assignedTo) {
      await publishAblyEvent({
        locationId: existingTask.locationId,
        userId: updateData.assignedTo,
        entity: updatedTask,
        eventType: 'task.assigned'
      });
    }

    console.log('✅ Task updated successfully with automation triggers and Ably events');
    
    return sendSuccess(res, { 
      task: updatedTask,
      updated: true 
    }, 'Task updated successfully');

  } catch (err) {
    console.error('❌ Failed to update task:', err);
    return sendServerError(res, err, 'Failed to update task');
  }
}
