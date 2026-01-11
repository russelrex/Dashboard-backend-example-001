// pages/api/cron/process-install-queue.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import { cleanupExpiredLocks } from '../../../src/utils/installQueue';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  
  if (!isVercelCron && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Clean up expired locks
    const cleanedLocks = await cleanupExpiredLocks(db);
    console.log(`[Install Queue Cron] Cleaned ${cleanedLocks} expired locks`);
    
    // Process install retry queue
    const retryQueue = await db.collection('install_retry_queue')
      .find({
        status: 'pending',
        nextRetryAt: { $lte: new Date() },
        attempts: { $lt: 3 }
      })
      .limit(10)
      .toArray();
    
    console.log(`[Install Queue Cron] Processing ${retryQueue.length} queued installs`);
    
    const results = {
      processed: 0,
      success: 0,
      failed: 0
    };
    
    for (const item of retryQueue) {
      try {
        // Update attempt count
        await db.collection('install_retry_queue').updateOne(
          { _id: item._id },
          {
            $inc: { attempts: 1 },
            $set: { 
              status: 'processing',
              lastAttempt: new Date()
            }
          }
        );
        
        // Check if this is a SETUP_LOCATION type
        if (item.payload.type === 'SETUP_LOCATION') {
          console.log(`[Install Queue Cron] Processing location setup for ${item.payload.locationId}`);
          
          // Call setup-location endpoint directly
          const response = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL || 'https://lpai-backend-omega.vercel.app'}/api/locations/setup-location`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                locationId: item.payload.locationId,
                fullSync: item.payload.fullSync 
              })
            }
          );

          if (response.ok) {
            const result = await response.json();
            
            // Update webhook metrics if we have the original webhook ID
            if (item.payload.originalWebhookId) {
              await db.collection('webhook_metrics').updateOne(
                { webhookId: item.payload.originalWebhookId },
                { 
                  $set: { 
                    'timestamps.steps.setupCompleted': new Date(),
                    'setupResult': result
                  } 
                }
              );
            }

            // Mark as complete
            await db.collection('install_retry_queue').updateOne(
              { _id: item._id },
              {
                $set: { 
                  status: 'completed',
                  completedAt: new Date(),
                  result: result
                }
              }
            );
            
            results.success++;
            console.log(`[Install Queue Cron] Setup completed for ${item.payload.locationId}`);
          } else {
            throw new Error(`Setup failed with status ${response.status}: ${response.statusText}`);
          }
        } else if (item.payload.type === 'ACTIVATE_CALENDARS') {
          console.log(`[Install Queue Cron] Processing calendar activation for ${item.payload.locationId}`);
          
          // Get location and users
          const location = await db.collection('locations').findOne({ 
            locationId: item.payload.locationId 
          });
          
          if (!location) {
            throw new Error('Location not found');
          }
          
          // Get users with GHL IDs
          const users = await db.collection('users').find({
            locationId: item.payload.locationId,
            ghlUserId: { $exists: true, $ne: null }
          }).toArray();
          
          console.log(`[Install Queue Cron] Found ${users.length} users for calendar activation`);
          
          if (users.length === 0) {
            // Retry in 30 seconds if no users yet
            await db.collection('install_retry_queue').updateOne(
              { _id: item._id },
              {
                $set: {
                  status: 'pending',
                  nextRetryAt: new Date(Date.now() + 30000),
                  lastAttempt: new Date()
                },
                $inc: { attempts: 1 }
              }
            );
            console.log(`[Install Queue Cron] No users found yet, retrying in 30 seconds`);
            continue;
          }
          
          // Get auth for GHL API
          const { getAuthHeader } = await import('../../../src/utils/ghlAuth');
          const auth = await getAuthHeader(location);
          const axios = (await import('axios')).default;
          
          let activatedCount = 0;
          
          // Activate each calendar - MINIMAL payload with FULL logging
          for (let i = 0; i < item.payload.calendarIds.length; i++) {
            const calendarId = item.payload.calendarIds[i];
            
            try {
              // Build team members array with locationConfigurations
              const teamMembers = users.map((user, index) => ({
                userId: user.ghlUserId,
                priority: 0.5,
                isPrimary: index === 0,
                locationConfigurations: [
                  {
                    kind: 'custom',
                    location: location.address || location.name || 'Business Location'
                  }
                ]
              }));
              
              // MINIMAL payload - only what we're changing
              const updatePayload = {
                teamMembers: teamMembers,
                isActive: true
              };
              
              const requestUrl = `https://services.leadconnectorhq.com/calendars/${calendarId}`;
              const requestHeaders = {
                'Authorization': auth.header,
                'Version': '2021-04-15',
                'Accept': 'application/json',
                'Content-Type': 'application/json'
              };
              
              // 📋 LOG THE FULL REQUEST
              console.log(`\n========================================`);
              console.log(`[Install Queue Cron] 🔄 ACTIVATING CALENDAR ${i + 1}/${item.payload.calendarIds.length}`);
              console.log(`========================================`);
              console.log(`Calendar ID: ${calendarId}`);
              console.log(`Location ID: ${item.payload.locationId}`);
              console.log(`Users to assign: ${users.length}`);
              console.log(`\n📤 REQUEST DETAILS:`);
              console.log(`URL: ${requestUrl}`);
              console.log(`Method: PUT`);
              console.log(`\n📋 Headers:`);
              console.log(JSON.stringify({
                ...requestHeaders,
                'Authorization': `${auth.header.substring(0, 20)}...` // Redact token
              }, null, 2));
              console.log(`\n📦 Payload:`);
              console.log(JSON.stringify(updatePayload, null, 2));
              
              // Make the API call
              const response = await axios.put(
                requestUrl,
                updatePayload,
                { headers: requestHeaders }
              );
              
              // 📥 LOG THE SUCCESS RESPONSE
              console.log(`\n✅ SUCCESS RESPONSE:`);
              console.log(`Status: ${response.status} ${response.statusText}`);
              console.log(`\n📋 Response Headers:`);
              console.log(JSON.stringify(response.headers, null, 2));
              console.log(`\n📦 Response Data:`);
              console.log(JSON.stringify(response.data, null, 2));
              console.log(`========================================\n`);
              
              activatedCount++;
              
              // Update MongoDB
              await db.collection('calendars').updateOne(
                { ghlCalendarId: calendarId, locationId: item.payload.locationId },
                { 
                  $set: { 
                    isActive: true,
                    lastActivated: new Date(),
                    assignedUsers: users.map(u => u.ghlUserId),
                    teamMembers: teamMembers,
                    updatedAt: new Date()
                  } 
                }
              );
              
            } catch (calError: any) {
              // 🚨 LOG THE FULL ERROR
              console.error(`\n========================================`);
              console.error(`[Install Queue Cron] ❌ CALENDAR ACTIVATION FAILED`);
              console.error(`========================================`);
              console.error(`Calendar ID: ${calendarId}`);
              console.error(`Location ID: ${item.payload.locationId}`);
              
              if (calError.response) {
                // GHL returned an error response
                console.error(`\n📥 ERROR RESPONSE:`);
                console.error(`Status: ${calError.response.status} ${calError.response.statusText}`);
                console.error(`\n📋 Response Headers:`);
                console.error(JSON.stringify(calError.response.headers, null, 2));
                console.error(`\n📦 Response Data:`);
                console.error(JSON.stringify(calError.response.data, null, 2));
              } else if (calError.request) {
                // Request was made but no response received
                console.error(`\n📤 REQUEST SENT BUT NO RESPONSE:`);
                console.error(calError.message);
              } else {
                // Error in setting up the request
                console.error(`\n⚠️ REQUEST SETUP ERROR:`);
                console.error(calError.message);
              }
              
              console.error(`\n📚 Full Error Stack:`);
              console.error(calError.stack);
              console.error(`========================================\n`);
            }
          }
          
          // Mark as complete
          await db.collection('install_retry_queue').updateOne(
            { _id: item._id },
            {
              $set: {
                status: 'completed',
                completedAt: new Date(),
                result: { activatedCount, totalCalendars: item.payload.calendarIds.length }
              }
            }
          );
          
          console.log(`[Install Queue Cron] Calendar activation complete: ${activatedCount}/${item.payload.calendarIds.length}`);
          results.success++;
        } else {
          // For other types (INSTALL, etc), add back to main queue for CriticalProcessor
          await db.collection('webhook_queue').insertOne({
            _id: new ObjectId(),
            webhookId: item.webhookId,
            type: item.payload.type,
            payload: item.payload,
            locationId: item.payload.locationId,
            status: 'pending',
            attempts: 0,
            queueType: 'critical',
            priority: 1,
            createdAt: new Date(),
            processAfter: new Date(),
            source: 'install_retry'
          });
          
          // Mark as complete in retry queue
          await db.collection('install_retry_queue').updateOne(
            { _id: item._id },
            {
              $set: { 
                status: 'completed',
                completedAt: new Date()
              }
            }
          );
          
          results.success++;
        }
      } catch (error: any) {
        console.error(`[Install Queue Cron] Failed to process ${item.webhookId}:`, error);
        
        // Update retry time
        const nextRetry = new Date(Date.now() + (item.attempts + 1) * 60 * 1000); // Exponential backoff
        
        await db.collection('install_retry_queue').updateOne(
          { _id: item._id },
          {
            $set: { 
              status: 'pending',
              lastError: error.message,
              nextRetryAt: nextRetry
            }
          }
        );
        
        results.failed++;
      }
      
      results.processed++;
    }
    
    // Process sync queue
    const syncQueue = await db.collection('sync_queue')
      .find({
        status: 'pending',
        scheduledFor: { $lte: new Date() },
        attempts: { $lt: 3 }
      })
      .limit(5)
      .toArray();
    
    console.log(`[Install Queue Cron] Processing ${syncQueue.length} sync jobs`);
    
    for (const syncJob of syncQueue) {
      try {
        if (syncJob.type === 'agency_sync') {
          // Call the sync endpoint
          const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://lpai-backend-omega.vercel.app'}/api/oauth/get-location-tokens`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companyId: syncJob.companyId })
          });
          
          if (response.ok) {
            await db.collection('sync_queue').updateOne(
              { _id: syncJob._id },
              { $set: { status: 'completed', completedAt: new Date() } }
            );
          } else {
            throw new Error(`Sync failed: ${response.status}`);
          }
        }
      } catch (error: any) {
        console.error(`[Install Queue Cron] Sync failed for ${syncJob.companyId}:`, error);
        
        await db.collection('sync_queue').updateOne(
          { _id: syncJob._id },
          {
            $inc: { attempts: 1 },
            $set: {
              lastError: error.message,
              scheduledFor: new Date(Date.now() + 5 * 60 * 1000) // Retry in 5 minutes
            }
          }
        );
      }
    }
    
    return res.status(200).json({
      success: true,
      installQueue: results,
      syncQueue: syncQueue.length,
      cleanedLocks: cleanedLocks,
      timestamp: new Date().toISOString()
    });
    
  } catch (error: any) {
    console.error('[Install Queue Cron] Fatal error:', error);
    return res.status(500).json({
      error: 'Install queue processing failed',
      message: error.message
    });
  }
}

export const config = {
  maxDuration: 60
};