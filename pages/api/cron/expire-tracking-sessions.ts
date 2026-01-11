/**
 * File: expire-tracking-sessions.ts
 * Purpose: Cron job to auto-expire old tracking sessions
 * Author: LPai Team
 * Last Modified: 2025-10-08
 * Schedule: Every 5 minutes
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify cron secret
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const now = new Date();

    // Expire sessions that have passed their expiry time
    const result = await db.collection('tracking_sessions').updateMany(
      {
        status: { $in: ['active', 'arrived'] },
        expiresAt: { $lt: now }
      },
      {
        $set: {
          status: 'expired',
          lastUpdatedAt: now
        }
      }
    );

    console.log('[TrackingExpiry] Expired sessions:', result.modifiedCount);

    return res.status(200).json({
      success: true,
      expired: result.modifiedCount,
      timestamp: now
    });

  } catch (error: any) {
    console.error('[TrackingExpiry] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to expire sessions',
      message: error.message 
    });
  }
}


