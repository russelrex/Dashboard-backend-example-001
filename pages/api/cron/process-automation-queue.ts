// File: pages/api/cron/process-automation-queue.ts
// Created: December 2024
// Description: Cron job for processing queued automation tasks

import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  
  if (!isVercelCron && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const client = await clientPromise;
  const db = client.db(getDbName());

  try {
    const now = new Date();
    
    // Only process pending items, NOT scheduled ones
    const pendingItems = await db.collection('automation_queue')
      .find({
        status: 'pending', // Explicitly exclude scheduled items
        attempts: { $lt: 3 },
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      })
      .limit(10)
      .toArray();
      
    // Don't touch scheduled items - they're handled by automation-scheduler

    console.log(`Processing ${pendingItems.length} automation tasks`);

    for (const task of pendingItems) {
      try {
        // Mark as processing
        await db.collection('automation_queue').updateOne(
          { _id: task._id },
          { 
            $set: { status: 'processing' },
            $inc: { attempts: 1 }
          }
        );

        // PASS THE ACTION DATA TO EXECUTE
        const executeBody = {
          trigger: task.trigger,
          _id: task._id,
          action: task.action,        // Individual action data
          actionType: task.actionType, // Action type for routing
          ruleId: task.ruleId
        };

        const executeResponse = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || 'https://lpai-backend-omega.vercel.app'}/api/automations/execute`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(executeBody)
          }
        );

        if (!executeResponse.ok) {
          throw new Error(`Execute failed: ${executeResponse.status}`);
        }

        // Mark as completed
        await db.collection('automation_queue').updateOne(
          { _id: task._id },
          { 
            $set: { 
              status: 'completed',
              completedAt: new Date()
            } 
          }
        );

      } catch (error) {
        console.error('Task processing error:', error);
        
        // Mark as failed
        await db.collection('automation_queue').updateOne(
          { _id: task._id },
          { 
            $set: { 
              status: task.attempts >= 3 ? 'failed' : 'pending',
              lastError: error instanceof Error ? error.message : String(error)
            } 
          }
        );
      }
    }

    // Clean up old completed tasks (older than 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    await db.collection('automation_queue').deleteMany({
      status: 'completed',
      completedAt: { $lt: sevenDaysAgo }
    });

    return res.json({ 
      success: true, 
      processed: pendingItems.length 
    });
  } catch (error) {
    console.error('Queue processing error:', error);
    return res.status(500).json({ error: 'Failed to process queue' });
  }
}