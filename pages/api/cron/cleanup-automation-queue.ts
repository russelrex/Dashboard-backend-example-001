import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '@/lib/mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const client = await clientPromise;
    const db = client.db('lpai');
    
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Delete completed items older than 7 days
    const deletedCompleted = await db.collection('automation_queue').deleteMany({
      status: 'completed',
      completedAt: { $lt: sevenDaysAgo }
    });
    
    // Delete ALL items older than 30 days regardless of status
    const deletedOld = await db.collection('automation_queue').deleteMany({
      createdAt: { $lt: thirtyDaysAgo }
    });
    
    // Delete skipped items older than 3 days
    const deletedSkipped = await db.collection('automation_queue').deleteMany({
      status: 'skipped',
      createdAt: { $lt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) }
    });
    
    // Get failed items from last 24 hours for notification
    const recentFailures = await db.collection('automation_queue').find({
      status: 'failed',
      createdAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) }
    }).toArray();
    
    // Send notification if there are failures
    if (recentFailures.length > 0) {
      // Group failures by error type
      const failureGroups = recentFailures.reduce((acc, item) => {
        const error = item.lastError || 'Unknown error';
        if (!acc[error]) acc[error] = [];
        acc[error].push(item);
        return acc;
      }, {} as Record<string, any[]>);
      
      // Send email notification
      await fetch('https://lpai-backend-omega.vercel.app/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'michael@leadprospecting.ai',
          subject: `⚠️ Automation Queue: ${recentFailures.length} failures in last 24h`,
          html: `
            <h2>Automation Queue Health Report</h2>
            <p><strong>${recentFailures.length}</strong> automations failed in the last 24 hours.</p>
            
            <h3>Failures by Error Type:</h3>
            <ul>
              ${Object.entries(failureGroups).map(([error, items]) => 
                `<li><strong>${error}:</strong> ${items.length} failures</li>`
              ).join('')}
            </ul>
            
            <h3>Cleanup Summary:</h3>
            <ul>
              <li>Deleted ${deletedCompleted.deletedCount} completed items (7+ days old)</li>
              <li>Deleted ${deletedSkipped.deletedCount} skipped items (3+ days old)</li>
              <li>Deleted ${deletedOld.deletedCount} old items (30+ days old)</li>
            </ul>
            
            <p><a href="https://lpai-backend-omega.vercel.app/api/automations/queue/stats">View Queue Stats</a></p>
          `
        })
      });
    }
    
    res.status(200).json({
      success: true,
      cleanup: {
        deletedCompleted: deletedCompleted.deletedCount,
        deletedSkipped: deletedSkipped.deletedCount,
        deletedOld: deletedOld.deletedCount
      },
      failures: recentFailures.length
    });
    
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ error: 'Cleanup failed' });
  }
}