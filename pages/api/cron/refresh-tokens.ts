// pages/api/cron/refresh-tokens.ts
// Updated: 2025-01-11 - Include company-level tokens in refresh
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { refreshOAuthToken, tokenNeedsRefresh } from '../../../src/utils/ghlAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const hasValidAuth = req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  
  if (!isVercelCron && !hasValidAuth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Find all locations AND companies with OAuth that need refresh
    const locations = await db.collection('locations').find({
      'ghlOAuth.accessToken': { $exists: true },
      'ghlOAuth.refreshToken': { $exists: true },
      $or: [
        { appInstalled: true },      // Location-level records
        { isCompanyLevel: true }     // Company-level records
      ]
    }).toArray();
    
    console.log(`[Token Refresh Cron] Checking ${locations.length} locations/companies`);
    
    const results = {
      checked: locations.length,
      refreshed: 0,
      failed: 0,
      errors: [] as any[]
    };
    
    // Process each location or company
    for (const location of locations) {
      try {
        if (tokenNeedsRefresh(location)) {
          const entityType = location.isCompanyLevel ? 'company' : 'location';
          const entityId = location.locationId || location.companyId;
          console.log(`[Token Refresh Cron] Refreshing token for ${entityType}: ${entityId}`);
          
          await refreshOAuthToken(location);
          results.refreshed++;
        }
      } catch (error: any) {
        const entityType = location.isCompanyLevel ? 'company' : 'location';
        const entityId = location.locationId || location.companyId;
        console.error(`[Token Refresh Cron] Failed for ${entityType} ${entityId}:`, error.message);
        
        results.failed++;
        results.errors.push({
          locationId: location.locationId,
          companyId: location.companyId,
          isCompanyLevel: location.isCompanyLevel,
          entityType: entityType,
          error: error.message
        });
      }
    }
    
    console.log(`[Token Refresh Cron] Complete - Refreshed: ${results.refreshed}, Failed: ${results.failed}`);
    
    return res.status(200).json({
      success: true,
      ...results
    });
    
  } catch (error: any) {
    console.error('[Token Refresh Cron] Fatal error:', error);
    return res.status(500).json({
      error: 'Token refresh cron failed',
      message: error.message
    });
  }
}