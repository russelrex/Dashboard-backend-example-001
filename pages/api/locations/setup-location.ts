// pages/api/locations/setup-location.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import { getAuthHeader } from '../../../src/utils/ghlAuth';
import axios from 'axios';

// Individual sync functions (we'll implement these next)
import { syncLocationDetails } from '../../../src/utils/sync/syncLocationDetails';
import { syncPhoneNumbers } from '../../../src/utils/sync/syncPhoneNumbers';
import { syncPipelines } from '../../../src/utils/sync/syncPipelines';
import { syncCalendars } from '../../../src/utils/sync/syncCalendars';
import { syncUsers } from '../../../src/utils/sync/syncUsers';
import { syncCustomFields } from '../../../src/utils/sync/syncCustomFields';
import { syncContacts } from '../../../src/utils/sync/syncContacts';
import { syncOpportunities } from '../../../src/utils/sync/syncOpportunities';
import { syncAppointments } from '../../../src/utils/sync/syncAppointments';
import { syncConversations } from '../../../src/utils/sync/syncConversations';
import { syncInvoices } from '../../../src/utils/sync/syncInvoices';
import { setupDefaults } from '../../../src/utils/sync/setupDefaults';
import { syncCustomValues } from '../../../src/utils/sync/syncCustomValues';
import { syncTags } from '../../../src/utils/sync/syncTags';
import { syncTasks } from '../../../src/utils/sync/syncTasks';
import { createPipelineCalendarRecordsAndMapAutomations } from '../../../src/utils/sync/createPipelineCalendarRecordsAndMapAutomations';
import { publishAblyEvent } from '../../../src/utils/ably/publishEvent';


export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { locationId, fullSync = true } = req.body;

  if (!locationId) {
    return res.status(400).json({ error: 'Location ID is required' });
  }

  console.log(`[Location Setup] Starting setup for location: ${locationId}`);

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Get location record
    let location = await db.collection('locations').findOne({ locationId });
    
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    // Initialize sync progress
    await db.collection('locations').updateOne(
      { _id: location._id },
      {
        $set: {
          'syncProgress': {
            overall: { status: 'starting', startedAt: new Date() },
            locationDetails: { status: 'pending' },
            phoneNumbers: { status: 'pending' },
            pipelines: { status: 'pending' },
            calendars: { status: 'pending' },
            users: { status: 'pending' },
            customFields: { status: 'pending' },
            tags: { status: 'pending' },
            customValues: { status: 'pending' },
            contacts: { status: 'pending' },
            tasks: { status: 'pending' },
            opportunities: { status: 'pending' },
            appointments: { status: 'pending' },
            conversations: { status: 'pending' },
            invoices: { status: 'pending' },
            defaults: { status: 'pending' },
            snapshot: { status: 'pending' },
            automationMapping: { status: 'pending' }
          }
        }
      }
    );

    // Check for OAuth tokens - handle both company-level and direct location installs
    
    // Scenario 1: Direct location OAuth (installed directly in sub-account)
    if (location.ghlOAuth?.accessToken) {
      console.log(`[Location Setup] Location has direct OAuth tokens`);
      console.log(`[Location Setup] Token expires at: ${location.ghlOAuth.expiresAt}`);
      console.log(`[Location Setup] Token user type: ${location.ghlOAuth.userType || 'not specified'}`);
      // Location has its own OAuth, we're good to go!
    }
    
    // Scenario 2: Company-level OAuth (installed at agency level)
    else if (location.companyId) {
      console.log(`[Location Setup] No direct OAuth, checking for company-level tokens...`);
      
      const companyRecord = await db.collection('locations').findOne({
        companyId: location.companyId,
        locationId: null,
        isCompanyLevel: true,
        'ghlOAuth.accessToken': { $exists: true }
      });
      
      if (companyRecord) {
        console.log(`[Location Setup] Company has OAuth, fetching location-specific tokens...`);
        
        try {
          // Fetch location-specific tokens from company tokens
          const tokenResponse = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL || 'https://lpai-backend-omega.vercel.app'}/api/oauth/get-location-tokens`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                companyId: location.companyId,
                locationId: location.locationId
              })
            }
          );
          
          if (tokenResponse.ok) {
            const result = await tokenResponse.json();
            console.log(`[Location Setup] Location tokens fetched successfully`);
            
            // Re-fetch location to get updated tokens
            location = await db.collection('locations').findOne({ locationId });
            
            // Log token details for debugging
            if (location.ghlOAuth) {
              console.log(`[Location Setup] Token expires at: ${location.ghlOAuth.expiresAt}`);
              console.log(`[Location Setup] Token derived from company: ${location.ghlOAuth.derivedFromCompany || false}`);
            }
          } else {
            const error = await tokenResponse.text();
            console.error(`[Location Setup] Token fetch failed:`, error);
            // Continue anyway - maybe they have an API key
          }
        } catch (error: any) {
          console.error(`[Location Setup] Error fetching tokens:`, error.message);
          // Continue anyway - maybe they have an API key
        }
      } else {
        console.log(`[Location Setup] No company OAuth found`);
      }
    }
    
    // Optional: Refresh tokens if they already exist but might be stale
    if (location.ghlOAuth?.accessToken && location.companyId) {
      // Even if location has tokens, check if we should refresh from company
      const tokenAge = location.ghlOAuth.installedAt ? 
        Date.now() - new Date(location.ghlOAuth.installedAt).getTime() : 
        Infinity;
      
      // Refresh if tokens are older than 1 hour
      if (tokenAge > 60 * 60 * 1000) {
        console.log(`[Location Setup] Existing tokens are ${Math.round(tokenAge / 1000 / 60)} minutes old, checking for fresher tokens...`);
        
        // Try to fetch fresh tokens from company (same code as above)
        const companyRecord = await db.collection('locations').findOne({
          companyId: location.companyId,
          locationId: null,
          isCompanyLevel: true,
          'ghlOAuth.accessToken': { $exists: true }
        });
        
        if (companyRecord) {
          try {
            const tokenResponse = await fetch(
              `${process.env.NEXT_PUBLIC_API_URL || 'https://lpai-backend-omega.vercel.app'}/api/oauth/get-location-tokens`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  companyId: location.companyId,
                  locationId: location.locationId
                })
              }
            );
            
            if (tokenResponse.ok) {
              console.log(`[Location Setup] Refreshed tokens from company`);
              location = await db.collection('locations').findOne({ locationId });
            }
          } catch (error: any) {
            console.error(`[Location Setup] Token refresh failed:`, error.message);
          }
        }
      }
    }

    // Now check if we have any auth method
    if (!location.ghlOAuth?.accessToken && !location.ghlOAuth.accessToken) {
      console.log(`[Location Setup] No authentication method found for location ${locationId}`);
      
      // If location is under a company, we can try to get tokens
      if (location.companyId && location.appInstalled) {
        console.log(`[Location Setup] Location is under company ${location.companyId}, checking for company OAuth...`);
        
        const companyRecord = await db.collection('locations').findOne({
          companyId: location.companyId,
          locationId: null,
          isCompanyLevel: true,
          'ghlOAuth.accessToken': { $exists: true }
        });
        
        if (companyRecord) {
          console.log(`[Location Setup] Company has OAuth, attempting to get location tokens...`);
          
          try {
            const tokenResponse = await fetch(
              `${process.env.NEXT_PUBLIC_API_URL || 'https://lpai-backend-omega.vercel.app'}/api/oauth/get-location-tokens`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  companyId: location.companyId,
                  locationId: location.locationId
                })
              }
            );
            
            if (tokenResponse.ok) {
              const result = await tokenResponse.json();
              console.log(`[Location Setup] Token fetch completed`);
              
              // Re-fetch location to get updated tokens
              location = await db.collection('locations').findOne({ locationId });
              
              if (!location.ghlOAuth?.accessToken) {
                console.log(`[Location Setup] Warning: Token fetch succeeded but location still has no OAuth`);
              }
            } else {
              const error = await tokenResponse.text();
              console.error(`[Location Setup] Token fetch failed:`, error);
            }
          } catch (error: any) {
            console.error(`[Location Setup] Error fetching tokens:`, error.message);
          }
        }
      }
    }

    // Now check if we have any auth method
    if (!location.ghlOAuth?.accessToken && !location.ghlOAuth.accessToken) {
      return res.status(400).json({ 
        error: 'No authentication method available for location',
        details: 'Location needs OAuth token or API key',
        suggestion: 'Complete OAuth flow or add API key'
      });
    }

    // Also check if token needs refresh (within 1 hour of expiry)
    if (location.ghlOAuth?.accessToken && location.ghlOAuth.expiresAt) {
      const expiresAt = new Date(location.ghlOAuth.expiresAt);
      const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
      
      if (expiresAt < oneHourFromNow) {
        console.log(`[Location Setup] Token expiring soon, will be refreshed during sync`);
      }
    }

    // Track setup progress
    const setupResults: any = {
      locationId,
      startedAt: new Date(),
      steps: {} as Record<string, any>
    };

    // Setup progress tracking
    const totalSteps = 17; // Total steps in setup process (added phone numbers)
    let completedSteps = 0;
    
    // Helper function to publish progress updates
    const publishProgress = async (currentPhase: number, stepName: string, completedTaskIds: string[] = []) => {
      try {
        const progress = Math.round((completedSteps / totalSteps) * 100);
        
        await publishAblyEvent({
          locationId,
          entity: {
            locationId,
            overallProgress: progress,
            currentPhase,
            phaseProgress: setupResults.steps,
            completedTaskIds,
            lastUpdated: new Date().toISOString()
          },
          eventType: 'progress-update',
          metadata: { stepName }
        });
        
        console.log(`[Ably] Published progress: ${progress}% - ${stepName}`);
      } catch (error) {
        console.error('[Ably] Failed to publish progress:', error);
      }
    };

    // 1. Sync Location Details
    await db.collection('locations').updateOne(
      { _id: location._id },
      { $set: { 'syncProgress.locationDetails.status': 'syncing' } }
    );
    try {
      console.log(`[Location Setup] Step 1: Syncing location details...`);
      const locationResult = await syncLocationDetails(db, location);
      setupResults.steps.locationDetails = { ...locationResult, success: true };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.locationDetails': { status: 'complete', ...locationResult } } }
      );
      
      completedSteps++;
      await publishProgress(1, 'Location Details', ['init']);
    } catch (error: any) {
      console.error(`[Location Setup] Location details sync failed:`, error);
      setupResults.steps.locationDetails = { success: false, error: error.message };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.locationDetails': { status: 'failed', error: error.message } } }
      );
    }

    // 1.5. Sync Phone Numbers
    await db.collection('locations').updateOne(
      { _id: location._id },
      { $set: { 'syncProgress.phoneNumbers.status': 'syncing' } }
    );
    try {
      console.log(`[Location Setup] Step 1.5: Syncing phone numbers...`);
      const phoneResult = await syncPhoneNumbers(db, location);
      setupResults.steps.phoneNumbers = { ...phoneResult, success: true };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { 
          $set: { 
            'syncProgress.phoneNumbers': { status: 'complete', ...phoneResult },
            phoneNumberCount: phoneResult.stored || 0
          } 
        }
      );
      
      completedSteps++;
      await publishProgress(1, 'Phone Numbers', ['init']);
    } catch (error: any) {
      console.error(`[Location Setup] Phone number sync failed:`, error);
      setupResults.steps.phoneNumbers = { success: false, error: error.message };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.phoneNumbers': { status: 'failed', error: error.message } } }
      );
    }

    // 1.6. Set Default SMS Number & Update All Users
    if (setupResults.steps.phoneNumbers?.success && setupResults.steps.phoneNumbers?.stored > 0) {
      try {
        console.log('[Location Setup] Step 1.6: Setting default SMS number...');
        
        // Get the phone numbers we just synced
        const freshLocation = await db.collection('locations').findOne({ locationId });
        const phoneNumbers = freshLocation?.smsPhoneNumbers || [];
        
        console.log(`[Location Setup] Found ${phoneNumbers.length} SMS-capable numbers`);
        phoneNumbers.forEach((num: any, index: number) => {
          console.log(`  ${index + 1}. ${num.number} (${num.label})`);
        });
        
        // Find first SMS-capable number
        const defaultSmsNumber = phoneNumbers.find((num: any) => num.capabilities?.sms);
        
        if (defaultSmsNumber) {
          console.log(`[Location Setup] Setting default SMS number: ${defaultSmsNumber.number}`);
          
          // Mark as default in the numbers array
          const numbersWithDefault = phoneNumbers.map((num: any) => ({
            ...num,
            isDefault: num.number === defaultSmsNumber.number
          }));
          
          // Update location with default number marked
          await db.collection('locations').updateOne(
            { locationId },
            { 
              $set: { 
                smsPhoneNumbers: numbersWithDefault,
                'settings.defaultSmsNumber': defaultSmsNumber.number,
                smsConfigUpdatedAt: new Date()
              } 
            }
          );
          
          // Update ALL users for this location
          const users = await db.collection('users').find({ 
            locationId,
            isActive: { $ne: false }
          }).toArray();
          
          console.log(`[Location Setup] Updating ${users.length} users with default SMS number`);
          
          for (const user of users) {
            await db.collection('users').updateOne(
              { _id: user._id },
              {
                $set: {
                  'preferences.communication.phoneProvider': 'native',
                  'preferences.communication.defaultPhoneNumber': defaultSmsNumber.number, // Keep for backward compat
                  'preferences.communication.smsNumberId': defaultSmsNumber._id.toString(), // ✅ Add the ID the app expects
                  'preferences.communication.smsProvider': 'native',
                  updatedAt: new Date().toISOString()
                }
              }
            );
          }
          
          console.log(`[Location Setup] ✅ Set default SMS number for location and ${users.length} users`);
        } else {
          console.log('[Location Setup] ⚠️ No SMS-capable numbers found');
        }
      } catch (error: any) {
        console.error(`[Location Setup] Failed to set default SMS number:`, error);
        // Don't fail the whole setup for this
      }
    }

    // 2. Apply GHL Master Snapshot (creates pipelines/calendars in GHL)
    await db.collection('locations').updateOne(
      { _id: location._id },
      { $set: { 'syncProgress.snapshot.status': 'syncing' } }
    );

    try {
      console.log(`[Location Setup] Step 2: Applying GHL master snapshot...`);
      
      // Apply snapshot to create GHL objects first
      await createGHLObjectsAndCaptureIDs(locationId, location);
      
      setupResults.steps.snapshot = { success: true, snapshotId: 'GfgcPIQHn7D6bgU0fylw' };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.snapshot': { status: 'complete', appliedAt: new Date() } } }
      );
      
      completedSteps++;
      await publishProgress(2, 'Snapshot Applied', ['init', 'snapshot']);
    } catch (error: any) {
      console.error(`[Location Setup] Snapshot application failed:`, error);
      setupResults.steps.snapshot = { success: false, error: error.message };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.snapshot': { status: 'failed', error: error.message } } }
      );
    }

    // 3. Sync Pipelines (now they exist from snapshot)
    await db.collection('locations').updateOne(
      { _id: location._id },
      { $set: { 'syncProgress.pipelines.status': 'syncing' } }
    );
    try {
      console.log(`[Location Setup] Step 3: Syncing pipelines...`);
      const pipelineResult = await syncPipelines(db, location);
      setupResults.steps.pipelines = { ...pipelineResult, success: true };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { 
          $set: { 
            'syncProgress.pipelines': { status: 'complete', ...pipelineResult },
            pipelineCount: pipelineResult.pipelineCount || 0
          } 
        }
      );
      
      completedSteps++;
      await publishProgress(2, 'Pipeline Sync', ['pipelines']);
      // Add a second call for the "Pipelines" step
      await publishProgress(2, 'Pipelines', ['pipelines']);
    } catch (error: any) {
      console.error(`[Location Setup] Pipeline sync failed:`, error);
      setupResults.steps.pipelines = { success: false, error: error.message };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.pipelines': { status: 'failed', error: error.message } } }
      );
    }

    // 4. Sync Calendars
    await db.collection('locations').updateOne(
      { _id: location._id },
      { $set: { 'syncProgress.calendars.status': 'syncing' } }
    );
    try {
      console.log(`[Location Setup] Step 4: Syncing calendars...`);
      const calendarResult = await syncCalendars(db, location);
      setupResults.steps.calendars = { ...calendarResult, success: true };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { 
          $set: { 
            'syncProgress.calendars': { status: 'complete', ...calendarResult },
            calendarCount: calendarResult.calendarCount || 0
          } 
        }
      );
      
      completedSteps++;
      await publishProgress(2, 'Calendar Sync', ['init', 'ghl_sync']);
      // Add a second call for "Calendar Integration"
      await publishProgress(2, 'Calendar Integration', ['init', 'ghl_sync']);

    } catch (error: any) {
      console.error(`[Location Setup] Calendar sync failed:`, error);
      setupResults.steps.calendars = { success: false, error: error.message };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.calendars': { status: 'failed', error: error.message } } }
      );
    }


    // 5. Sync Users
    await db.collection('locations').updateOne(
      { _id: location._id },
      { $set: { 'syncProgress.users.status': 'syncing' } }
    );
    try {
      console.log(`[Location Setup] Step 5: Syncing users...`);
      const userResult = await syncUsers(db, location);
      setupResults.steps.users = { ...userResult, success: true };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { 
          $set: { 
            'syncProgress.users': { status: 'complete', ...userResult },
            userCount: userResult.total || 0
          } 
        }
      );
      
      completedSteps++;
      await publishProgress(3, 'User Sync', ['init', 'ghl_sync']);
      await publishProgress(3, 'Team Members', ['init', 'ghl_sync', 'contacts_sync']);
    } catch (error: any) {
      console.error(`[Location Setup] User sync failed:`, error);
      setupResults.steps.users = { success: false, error: error.message };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.users': { status: 'failed', error: error.message } } }
      );
    }

    // 6. Sync Custom Fields
    await db.collection('locations').updateOne(
      { _id: location._id },
      { $set: { 'syncProgress.customFields.status': 'syncing' } }
    );
    try {
      console.log(`[Location Setup] Step 6: Syncing custom fields...`);
      const customFieldResult = await syncCustomFields(db, location);
      setupResults.steps.customFields = { ...customFieldResult, success: true };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.customFields': { status: 'complete', ...customFieldResult } } }
      );
      
      completedSteps++;
      await publishProgress(3, 'Custom Fields Sync', ['init', 'ghl_sync']);
      await publishProgress(3, 'Custom Fields', ['init', 'ghl_sync', 'contacts_sync']);
    } catch (error: any) {
      console.error(`[Location Setup] Custom field sync failed:`, error);
      setupResults.steps.customFields = { success: false, error: error.message };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.customFields': { status: 'failed', error: error.message } } }
      );
    }

    // 7. Sync Tags
    await db.collection('locations').updateOne(
      { _id: location._id },
      { $set: { 'syncProgress.tags.status': 'syncing' } }
    );
    try {
      console.log(`[Location Setup] Step 7: Syncing tags...`);
      const tagsResult = await syncTags(db, location);
      setupResults.steps.tags = { ...tagsResult, success: true };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { 
          $set: { 
            'syncProgress.tags': { status: 'complete', ...tagsResult },
            tagCount: tagsResult.totalTags || 0
          } 
        }
      );
      
      completedSteps++;
      await publishProgress(3, 'Tags Sync', ['init', 'ghl_sync']);
      await publishProgress(3, 'Tags & Categories', ['init', 'ghl_sync', 'contacts_sync']);
    } catch (error: any) {
      console.error(`[Location Setup] Tags sync failed:`, error);
      setupResults.steps.tags = { success: false, error: error.message };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.tags': { status: 'failed', error: error.message } } }
      );
    }

    // 8. Sync Custom Values
    await db.collection('locations').updateOne(
      { _id: location._id },
      { $set: { 'syncProgress.customValues.status': 'syncing' } }
    );
    try {
      console.log(`[Location Setup] Step 8: Syncing custom values...`);
      const customValuesResult = await syncCustomValues(db, location);
      setupResults.steps.customValues = { ...customValuesResult, success: true };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.customValues': { status: 'complete', ...customValuesResult } } }
      );
      
      completedSteps++;
      await publishProgress(3, 'Custom Values Sync', ['init', 'ghl_sync']);
      await publishProgress(3, 'Custom Values', ['init', 'ghl_sync', 'contacts_sync']);
    } catch (error: any) {
      console.error(`[Location Setup] Custom values sync failed:`, error);
      setupResults.steps.customValues = { success: false, error: error.message };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.customValues': { status: 'failed', error: error.message } } }
      );
    }

    // Only do full sync if requested (for initial setup)
    if (fullSync) {
      // 9. Sync Contacts
      await db.collection('locations').updateOne(
        { _id: location._id },
        {
          $set: {
            'syncProgress.contacts': {
              status: 'starting',
              current: 0,
              total: 0,
              percent: 0,
              startedAt: new Date()
            }
          }
        }
      );
      try {
        console.log(`[Location Setup] Step 9: Syncing contacts (initial batch)...`);
        const contactResult = await syncContacts(db, location, { fullSync: true });
        setupResults.steps.contacts = { ...contactResult, success: true };
        
        await db.collection('locations').updateOne(
          { _id: location._id },
          {
            $set: {
              'syncProgress.contacts': {
                status: 'complete',
                current: contactResult.created + contactResult.updated,
                total: contactResult.totalInGHL || contactResult.created + contactResult.updated,
                percent: 100,
                completedAt: new Date(),
                created: contactResult.created,
                updated: contactResult.updated
              },
              contactCount: contactResult.created + contactResult.updated
            }
          }
        );
        
        completedSteps++;
        await publishProgress(4, 'Contact Sync', ['init', 'ghl_sync', 'contacts_sync']);
        await publishProgress(4, 'Contact Sync', ['init', 'ghl_sync', 'contacts_sync']); // Second one like in logs
        await publishProgress(4, 'Contact Database', ['init', 'ghl_sync', 'contacts_sync', 'pipelines']);
      } catch (error: any) {
        console.error(`[Location Setup] Contact sync failed:`, error);
        setupResults.steps.contacts = { success: false, error: error.message };
        await db.collection('locations').updateOne(
          { _id: location._id },
          { $set: { 'syncProgress.contacts': { status: 'failed', error: error.message } } }
        );
      }

      // 10. Sync Tasks
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.tasks.status': 'syncing' } }
      );
      try {
        console.log(`[Location Setup] Step 10: Syncing tasks (last 90 days)...`);
        const tasksResult = await syncTasks(db, location, { daysBack: 90 });
        setupResults.steps.tasks = { ...tasksResult, success: true };
        await db.collection('locations').updateOne(
          { _id: location._id },
          { 
            $set: { 
              'syncProgress.tasks': { status: 'complete', ...tasksResult },
              taskCount: tasksResult.created + tasksResult.updated
            } 
          }
        );
        
        completedSteps++;
        await publishProgress(4, 'Tasks Sync', ['init', 'ghl_sync', 'contacts_sync']);
        await publishProgress(4, 'Task Management', ['init', 'ghl_sync', 'contacts_sync', 'pipelines']);
      } catch (error: any) {
        console.error(`[Location Setup] Tasks sync failed:`, error);
        setupResults.steps.tasks = { success: false, error: error.message };
        await db.collection('locations').updateOne(
          { _id: location._id },
          { $set: { 'syncProgress.tasks': { status: 'failed', error: error.message } } }
        );
      }

      // 11. Sync Opportunities
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.opportunities.status': 'syncing' } }
      );
      try {
        console.log(`[Location Setup] Step 11: Syncing opportunities...`);
        const opportunityResult = await syncOpportunities(db, location, { fullSync: true });
        setupResults.steps.opportunities = { ...opportunityResult, success: true };
        await db.collection('locations').updateOne(
          { _id: location._id },
          { 
            $set: { 
              'syncProgress.opportunities': { status: 'complete', ...opportunityResult },
              projectCount: opportunityResult.created + opportunityResult.updated
            } 
          }
        );
        
        completedSteps++;
        await publishProgress(5, 'Opportunities Sync', ['init', 'ghl_sync', 'contacts_sync', 'pipelines']);
        await publishProgress(5, 'Sales Pipeline', ['init', 'ghl_sync', 'contacts_sync', 'pipelines', 'automations']);
      } catch (error: any) {
        console.error(`[Location Setup] Opportunity sync failed:`, error);
        setupResults.steps.opportunities = { success: false, error: error.message };
        await db.collection('locations').updateOne(
          { _id: location._id },
          { $set: { 'syncProgress.opportunities': { status: 'failed', error: error.message } } }
        );
      }

      // 12. Sync Appointments
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.appointments.status': 'syncing' } }
      );
      try {
        console.log(`[Location Setup] Step 12: Syncing appointments...`);
        const appointmentResult = await syncAppointments(db, location, { fullSync: true });
        setupResults.steps.appointments = { ...appointmentResult, success: true };
        await db.collection('locations').updateOne(
          { _id: location._id },
          { 
            $set: { 
              'syncProgress.appointments': { status: 'complete', ...appointmentResult },
              appointmentCount: appointmentResult.created + appointmentResult.updated
            } 
          }
        );
        
        completedSteps++;
        await publishProgress(6, 'Appointments Sync', ['init', 'ghl_sync', 'contacts_sync', 'pipelines', 'automations']);
        await publishProgress(6, 'Calendar & Appointments', ['init', 'ghl_sync', 'contacts_sync', 'pipelines', 'automations', 'templates']);
      } catch (error: any) {
        console.error(`[Location Setup] Appointment sync failed:`, error);
        setupResults.steps.appointments = { success: false, error: error.message };
        await db.collection('locations').updateOne(
          { _id: location._id },
          { $set: { 'syncProgress.appointments': { status: 'failed', error: error.message } } }
        );
      }

      // 13. Sync Conversations
      await db.collection('locations').updateOne(
        { _id: location._id },
        {
          $set: {
            'syncProgress.conversations': {
              status: 'starting',
              current: 0,
              total: 0,
              percent: 0,
              startedAt: new Date()
            }
          }
        }
      );
      try {
        console.log(`[Location Setup] Step 13: Syncing conversations...`);
        const conversationResult = await syncConversations(db, location, { limit: 50, fullSync: true });
        setupResults.steps.conversations = { ...conversationResult, success: true };
        
        await db.collection('locations').updateOne(
          { _id: location._id },
          {
            $set: {
              'syncProgress.conversations': {
                status: 'complete',
                current: conversationResult.created + conversationResult.updated,
                total: conversationResult.totalInGHL || conversationResult.created + conversationResult.updated,
                percent: 100,
                completedAt: new Date(),
                created: conversationResult.created,
                updated: conversationResult.updated,
                messagesProcessed: conversationResult.messagesProcessed
              },
              conversationCount: conversationResult.created + conversationResult.updated
            }
          }
        );
        
        completedSteps++;
        await publishProgress(7, 'Conversations Sync', ['init', 'ghl_sync', 'contacts_sync', 'pipelines', 'automations', 'templates']);
        await publishProgress(7, 'Message History', ['init', 'ghl_sync', 'contacts_sync', 'pipelines', 'automations', 'templates', 'integrations']);
      } catch (error: any) {
        console.error(`[Location Setup] Conversation sync failed:`, error);
        setupResults.steps.conversations = { success: false, error: error.message };
        await db.collection('locations').updateOne(
          { _id: location._id },
          { $set: { 'syncProgress.conversations': { status: 'failed', error: error.message } } }
        );
      }

      // 14. Sync Invoices
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.invoices.status': 'syncing' } }
      );
      try {
        console.log(`[Location Setup] Step 14: Syncing invoices...`);
        const invoiceResult = await syncInvoices(db, location, { limit: 100 });
        setupResults.steps.invoices = { ...invoiceResult, success: true };
        await db.collection('locations').updateOne(
          { _id: location._id },
          { 
            $set: { 
              'syncProgress.invoices': { status: 'complete', ...invoiceResult },
              invoiceCount: invoiceResult.created + invoiceResult.updated
            } 
          }
        );
        
        completedSteps++;
        await publishProgress(7, 'Invoices Sync', ['init', 'ghl_sync', 'contacts_sync', 'pipelines', 'automations', 'templates']);
        await publishProgress(7, 'Financial Records', ['init', 'ghl_sync', 'contacts_sync', 'pipelines', 'automations', 'templates', 'integrations']);
      } catch (error: any) {
        console.error(`[Location Setup] Invoice sync failed:`, error);
        setupResults.steps.invoices = { success: false, error: error.message };
        await db.collection('locations').updateOne(
          { _id: location._id },
          { $set: { 'syncProgress.invoices': { status: 'failed', error: error.message } } }
        );
      }
    }

    // 15. Setup Defaults
    await db.collection('locations').updateOne(
      { _id: location._id },
      { $set: { 'syncProgress.defaults.status': 'syncing' } }
    );
    try {
      console.log(`[Location Setup] Step 15: Setting up defaults...`);
      const defaultsResult = await setupDefaults(db, location);
      setupResults.steps.defaults = { ...defaultsResult, success: true };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.defaults': { status: 'complete', ...defaultsResult } } }
      );
      
      completedSteps++;
      await publishProgress(8, 'Defaults Sync', ['init', 'ghl_sync', 'contacts_sync', 'pipelines', 'automations', 'templates']);
      await publishProgress(8, 'System Configuration', ['init', 'ghl_sync', 'contacts_sync', 'pipelines', 'automations', 'templates', 'integrations']);
    } catch (error: any) {
      console.error(`[Location Setup] Defaults setup failed:`, error);
      setupResults.steps.defaults = { success: false, error: error.message };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.defaults': { status: 'failed', error: error.message } } }
      );
    }


    // Snapshot step moved to step 2 - this section removed

    // 16. Create MongoDB Pipeline/Calendar Records & Map Automations
    await db.collection('locations').updateOne(
      { _id: location._id },
      { $set: { 'syncProgress.automationMapping.status': 'syncing' } }
    );
    try {
      console.log(`[Location Setup] Step 16: Creating pipeline/calendar records and mapping automations...`);
      const mappingResult = await createPipelineCalendarRecordsAndMapAutomations(db, locationId);
      setupResults.steps.automationMapping = { ...mappingResult, success: true };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.automationMapping': { status: 'complete', ...mappingResult } } }
      );
      
      completedSteps++;
      await publishProgress(9, 'Automation Mapping - Location Settings', ['init', 'ghl_sync', 'contacts_sync', 'pipelines', 'automations', 'templates', 'integrations']);
      await publishProgress(9, 'Automation Mapping - Complete', ['init', 'ghl_sync', 'contacts_sync', 'pipelines', 'automations', 'templates', 'integrations', 'finalization']);
    } catch (error: any) {
      console.error(`[Location Setup] Automation mapping failed:`, error);
      setupResults.steps.automationMapping = { success: false, error: error.message };
      await db.collection('locations').updateOne(
        { _id: location._id },
        { $set: { 'syncProgress.automationMapping': { status: 'failed', error: error.message } } }
      );
    }

    // Update location as setup complete
    const completedAt = new Date();
    const duration = `${(completedAt.getTime() - setupResults.startedAt.getTime()) / 1000}s`;
    
    setupResults.completedAt = completedAt;
    setupResults.duration = duration;

    await db.collection('locations').updateOne(
      { _id: location._id },
      {
        $set: {
          setupCompleted: true,
          setupCompletedAt: completedAt,
          lastSetupRun: completedAt,
          setupResults: setupResults,
          'syncProgress.overall': {
            status: 'complete',
            completedAt: completedAt,
            duration: duration
          }
        }
      }
    );

    // Count successes and failures
    const successCount = Object.values(setupResults.steps).filter((s: any) => s.success).length;
    const failureCount = Object.values(setupResults.steps).filter((s: any) => !s.success).length;

    console.log(`[Location Setup] Completed for ${locationId}: ${successCount} successful, ${failureCount} failed`);

    // Publish final completion event
    try {
      await publishAblyEvent({
        locationId,
        entity: {
          locationId,
          completedAt: completedAt.toISOString()
        },
        eventType: 'installation-complete',
        metadata: { successCount, failureCount }
      });
      
      console.log(`[Ably] Published installation-complete for ${locationId}`);
    } catch (error) {
      console.error('[Ably] Failed to publish completion:', error);
    }

    return res.status(200).json({
      success: true,
      message: `Location setup completed: ${successCount} successful, ${failureCount} failed`,
      locationId,
      results: setupResults
    });

  } catch (error: any) {
    console.error('[Location Setup] Fatal error:', error);
    
    // Update sync progress to show failure
    try {
      const client = await clientPromise;
      const db = client.db(getDbName());
      await db.collection('locations').updateOne(
        { locationId },
        {
          $set: {
            'syncProgress.overall': {
              status: 'failed',
              error: error.message,
              failedAt: new Date()
            }
          }
        }
      );
    } catch (updateError) {
      console.error('[Location Setup] Failed to update error status:', updateError);
    }
    
    return res.status(500).json({
      error: 'Location setup failed',
      message: error.message,
      locationId
    });
  }
}

// GHL Snapshot Application Function
async function createGHLObjectsAndCaptureIDs(locationId: string, location: any) {
  console.log(`[GHL Objects] Applying master snapshot to location: ${locationId}`);
  console.log(`[GHL Objects] Location data:`, JSON.stringify({
    locationId: location.locationId,
    companyId: location.companyId,
    hasOAuth: !!location.ghlOAuth,
    oAuthUserType: location.ghlOAuth?.userType,
    tokenExists: !!location.ghlOAuth?.accessToken
  }, null, 2));
  
  const client = await clientPromise;
  const db = client.db(getDbName());
  
  try {
    // Use private API key v2.0 instead of OAuth tokens to avoid scope limitations
    const privateApiKey = process.env.GHL_PRIVATE_API_KEY || 'pit-630e2085-e598-4da8-9eec-44d6494a4479';
    
    const authHeader = `Bearer ${privateApiKey}`;
    
    console.log(`[GHL Objects] Using private API key instead of OAuth token`);
    console.log(`[GHL Objects] API key preview: ${privateApiKey.substring(0, 50)}...`);

    // 1. APPLY MASTER SNAPSHOT TO THE LOCATION WITH DETAILED LOGGING
    const snapshotId = process.env.GHL_MASTER_SNAPSHOT_ID || 'GfgcPIQHn7D6bgU0fylw';
    console.log(`[GHL Objects] Applying snapshot ${snapshotId} to location ${locationId}`);
    
    const requestBody = {
      companyId: location.companyId, // Required field according to GHL docs
      snapshot: {
        id: snapshotId,
        override: true // This replaces existing setup completely
      }
    };
    
    console.log(`[GHL Objects] Request URL: https://services.leadconnectorhq.com/locations/${locationId}`);
    console.log(`[GHL Objects] Request headers:`, {
      'Authorization': `Bearer ${privateApiKey.substring(0, 20)}...`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    });
    console.log(`[GHL Objects] Request body:`, JSON.stringify(requestBody, null, 2));
    
    const snapshotResponse = await fetch(`https://services.leadconnectorhq.com/locations/${locationId}`, {
      method: 'PUT',
      headers: {
        'Authorization': authHeader,
        'Version': '2021-07-28',
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    console.log(`[GHL Objects] Response status: ${snapshotResponse.status}`);
    console.log(`[GHL Objects] Response headers:`, Object.fromEntries(snapshotResponse.headers.entries()));

    if (!snapshotResponse.ok) {
      const errorText = await snapshotResponse.text();
      console.error(`[GHL Objects] Snapshot application failed with status ${snapshotResponse.status}`);
      console.error(`[GHL Objects] Error response:`, errorText);
      console.error(`[GHL Objects] Request was made with:`, {
        url: `https://services.leadconnectorhq.com/locations/${locationId}`,
        method: 'PUT',
        authType: 'Private API Key',
        apiKeyPreview: `${privateApiKey.substring(0, 20)}...`,
        snapshotId: snapshotId,
        companyId: location.companyId
      });
      
      // If it's a 401 error, log API key issues for debugging
      if (snapshotResponse.status === 401) {
        console.error(`[GHL Objects] 401 Unauthorized - Private API key may be invalid or expired`);
        console.error(`[GHL Objects] Check GHL_PRIVATE_API_KEY environment variable`);
      }
      
      throw new Error(`Snapshot application failed: ${errorText}`);
    }

    console.log('[GHL Objects] Snapshot applied successfully, waiting for propagation...');
    
    // 2. WAIT FOR SNAPSHOT TO PROPAGATE (GHL needs time to create all objects)
    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds

    // 3. CAPTURE ALL THE NEW OBJECTS CREATED BY THE SNAPSHOT
    const [pipelines, calendars] = await Promise.all([
      fetchGHLPipelines(locationId, authHeader),
      fetchGHLCalendars(locationId, authHeader)
    ]);

    console.log(`[GHL Objects] Captured ${pipelines.length} pipelines and ${calendars.length} calendars from snapshot`);

    // 4. STORE ALL OBJECTS IN YOUR DATABASE
    await storePipelinesAndCalendars(db, locationId, pipelines, calendars);

    // 5. MAP YOUR AUTOMATION TEMPLATES TO USE THE NEW GHL IDS
    await mapAutomationTemplates(db, locationId, { pipelines, calendars });

    // 6. STORE THE MAPPING RESULTS
    await db.collection('locations').updateOne(
      { locationId },
      {
        $set: {
          ghlObjects: {
            pipelines: pipelines.map(p => ({
              name: p.name,
              ghlPipelineId: p.id,
              stages: p.stages,
              appliedAt: new Date()
            })),
            calendars: calendars.map(c => ({
              name: c.name,
              ghlCalendarId: c.id,
              appliedAt: new Date()
            }))
          },
          snapshotApplied: {
            snapshotId: process.env.GHL_MASTER_SNAPSHOT_ID,
            appliedAt: new Date(),
            success: true
          },
          ghlObjectsLastUpdated: new Date(),
          hasGHLObjects: true
        }
      }
    );

    console.log(`[GHL Objects] Installation complete! Snapshot applied and ${pipelines.length + calendars.length} objects mapped.`);

  } catch (error) {
    console.error('[GHL Objects] Error applying snapshot:', error);
    
    // Mark the snapshot as failed but don't crash the installation
    await db.collection('locations').updateOne(
      { locationId },
      {
        $set: {
          snapshotApplied: {
            snapshotId: process.env.GHL_MASTER_SNAPSHOT_ID,
            appliedAt: new Date(),
            success: false,
            error: error.message
          }
        }
      }
    );
  }
}

// Helper functions for snapshot-based GHL setup
async function fetchGHLPipelines(locationId: string, authHeader: string) {
  const response = await fetch(`https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${locationId}`, {
    headers: { 'Authorization': authHeader, 'Version': '2021-07-28' }
  });
  
  if (response.ok) {
    const data = await response.json();
    return data.pipelines || [];
  }
  return [];
}

async function fetchGHLCalendars(locationId: string, authHeader: string) {
  const response = await fetch(`https://services.leadconnectorhq.com/calendars/?locationId=${locationId}`, {
    headers: { 'Authorization': authHeader, 'Version': '2021-04-15' }
  });
  
  if (response.ok) {
    const data = await response.json();
    return data.calendars || [];
  }
  return [];
}

async function storePipelinesAndCalendars(db: any, locationId: string, pipelines: any[], calendars: any[]) {
  // Store pipelines
  for (const pipeline of pipelines) {
    await db.collection('pipelines').insertOne({
      locationId,
      ghlPipelineId: pipeline.id,
      name: pipeline.name,
      stages: pipeline.stages || [],
      isActive: true,
      enableAutomation: true,
      createdAt: new Date(),
      source: 'snapshot_applied'
    });
  }

  // Store calendars
  for (const calendar of calendars) {
    await db.collection('calendars').insertOne({
      locationId,
      ghlCalendarId: calendar.id,
      name: calendar.name,
      slotDuration: calendar.slotDuration,
      slotInterval: calendar.slotInterval,
      isActive: true,
      createdAt: new Date(),
      source: 'snapshot_applied'
    });
  }
}

async function mapAutomationTemplates(db: any, locationId: string, ghlObjects: any) {
  console.log(`[Automation Mapping] Starting for location: ${locationId}`);
  
  try {
    // Get all automation templates for this location
    const automations = await db.collection('automation_rules').find({ 
      locationId,
      source: 'auto_install' 
    }).toArray();

    for (const automation of automations) {
      let needsUpdate = false;
      const updates = {};

      // Map stage-based triggers
      if (automation.trigger?.type?.includes('stage')) {
        const targetStageName = automation.trigger.config?.stageName || automation.name;
        
        for (const pipeline of ghlObjects.pipelines) {
          const stage = pipeline.stages.find(s => 
            s.name.toLowerCase() === targetStageName.toLowerCase() ||
            targetStageName.toLowerCase().includes(s.name.toLowerCase())
          );
          
          if (stage) {
            updates['trigger.config.pipelineId'] = pipeline.id;
            updates['trigger.config.stageId'] = stage.id;
            needsUpdate = true;
            console.log(`[Automation Mapping] Mapped ${automation.name} to stage ${stage.name}`);
            break;
          }
        }
      }

      // Map calendar-based actions
      if (automation.actions?.some(action => action.type === 'create-appointment')) {
        automation.actions.forEach((action, index) => {
          if (action.type === 'create-appointment' && action.config?.calendarName) {
            const calendar = ghlObjects.calendars.find(c => 
              c.name.toLowerCase() === action.config.calendarName.toLowerCase()
            );
            
            if (calendar) {
              updates[`actions.${index}.config.calendarId`] = calendar.id;
              needsUpdate = true;
              console.log(`[Automation Mapping] Mapped calendar action to ${calendar.name}`);
            }
          }
        });
      }

      // Update automation if mappings were found
      if (needsUpdate) {
        await db.collection('automation_rules').updateOne(
          { _id: automation._id },
          { $set: updates }
        );
      }
    }

    console.log(`[Automation Mapping] Completed for ${automations.length} automations`);

  } catch (error) {
    console.error('[Automation Mapping] Error:', error);
  }
}

// Extend timeout for Vercel (this process can take a while)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
    responseLimit: false,
    externalResolver: true,
  },
  maxDuration: 300 // 5 minutes max
};