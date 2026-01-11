import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '@/lib/mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const client = await clientPromise;
  const db = client.db('lpai');
  
  // Check webhook queue for automation triggers
  const recentWebhooks = await db.collection('webhook_queue').find({
    createdAt: { $gte: new Date(Date.now() - 24*60*60*1000) },
    'data.type': { $exists: true }
  }).limit(20).sort({ createdAt: -1 }).toArray();
  
  // Check automation queue
  const automationQueue = await db.collection('automation_queue').find({
    createdAt: { $gte: new Date(Date.now() - 24*60*60*1000) }
  }).limit(20).sort({ createdAt: -1 }).toArray();
  
  // Map event types
  const eventTypes = {};
  recentWebhooks.forEach(w => {
    const type = w.data?.type || w.eventType || 'unknown';
    eventTypes[type] = (eventTypes[type] || 0) + 1;
  });
  
  return res.json({
    webhookEvents: Object.keys(eventTypes).length,
    eventTypeCounts: eventTypes,
    automationQueueItems: automationQueue.length,
    queueStatus: automationQueue.map(q => ({
      trigger: q.trigger?.type,
      status: q.status,
      created: q.createdAt,
      error: q.error
    })),
    sampleWebhook: recentWebhooks[0] ? {
      type: recentWebhooks[0].data?.type,
      eventType: recentWebhooks[0].eventType,
      created: recentWebhooks[0].createdAt
    } : null
  });
}
