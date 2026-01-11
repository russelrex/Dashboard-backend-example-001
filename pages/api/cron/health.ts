import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '@/lib/mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db('lpai');
    
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Get stats
    const [
      totalPending,
      recentFailures,
      failuresLastHour,
      oldestPending,
      stats
    ] = await Promise.all([
      db.collection('automation_queue').countDocuments({ status: 'pending' }),
      db.collection('automation_queue').countDocuments({ 
        status: 'failed',
        createdAt: { $gte: oneDayAgo }
      }),
      db.collection('automation_queue').countDocuments({
        status: 'failed',
        createdAt: { $gte: oneHourAgo }
      }),
      db.collection('automation_queue').findOne(
        { status: 'pending' },
        { sort: { createdAt: 1 } }
      ),
      db.collection('automation_queue').aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            avgProcessingTime: {
              $avg: {
                $subtract: ['$processingCompleted', '$processingStarted']
              }
            }
          }
        }
      ]).toArray()
    ]);
    
    // Check health status
    const health = {
      status: 'healthy',
      issues: [] as string[]
    };
    
    if (totalPending > 100) {
      health.status = 'warning';
      health.issues.push(`High pending queue: ${totalPending} items`);
    }
    
    if (failuresLastHour > 10) {
      health.status = 'critical';
      health.issues.push(`High failure rate: ${failuresLastHour} in last hour`);
    }
    
    if (oldestPending) {
      const age = now.getTime() - new Date(oldestPending.createdAt).getTime();
      const ageHours = age / (1000 * 60 * 60);
      if (ageHours > 24) {
        health.status = 'warning';
        health.issues.push(`Oldest pending item is ${Math.round(ageHours)} hours old`);
      }
    }
    
    res.status(200).json({
      health,
      metrics: {
        totalPending,
        recentFailures,
        failuresLastHour,
        oldestPending: oldestPending ? {
          id: oldestPending._id,
          age: `${Math.round((now.getTime() - new Date(oldestPending.createdAt).getTime()) / (1000 * 60))} minutes`,
          trigger: oldestPending.trigger?.type
        } : null
      },
      stats: stats.reduce((acc, s) => {
        acc[s._id] = {
          count: s.count,
          avgProcessingTime: s.avgProcessingTime ? `${Math.round(s.avgProcessingTime)}ms` : 'N/A'
        };
        return acc;
      }, {} as Record<string, any>)
    });
    
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ 
      health: { status: 'error', issues: ['Health check failed'] }
    });
  }
}