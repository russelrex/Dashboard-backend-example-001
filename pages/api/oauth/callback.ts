// pages/api/oauth/callback.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import axios from 'axios';
import { acquireInstallLock, releaseInstallLock } from '../../../src/utils/installQueue';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code } = req.query;
  
  console.log('[OAuth Callback] Received:', req.query);
  console.log('[OAuth Debug] Full query params:', JSON.stringify(req.query, null, 2));
  console.log('[OAuth Debug] Full URL:', req.url);
  console.log('[OAuth Debug] Headers:', req.headers);

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  const client = await clientPromise;
  const db = client.db('lpai');

  try {
    // Detect which app based on referer since client_id is not passed by GHL
    const referer = req.headers.referer || '';
    const isMarketplaceInstall = referer.includes('marketplace.gohighlevel.com');
    
    // Always use FieldServ credentials for main callback
    const appCredentials = {
      client_id: process.env.GHL_FIELDSERV_CLIENT_ID,
      client_secret: process.env.GHL_FIELDSERV_CLIENT_SECRET
    };
    console.log('[OAuth Callback] Using FieldServ marketplace credentials');
    
    console.log('[OAuth Callback] Referer:', referer);
    console.log('[OAuth Callback] Is marketplace install:', isMarketplaceInstall);
    console.log('[OAuth Callback] Using app credentials for:', appCredentials.client_id);

    // Exchange code for tokens
    console.log('[OAuth Callback] Exchanging code for tokens...');
    
    const tokenResponse = await axios.post(
      'https://services.leadconnectorhq.com/oauth/token',
      new URLSearchParams({
        client_id: appCredentials.client_id!,
        client_secret: appCredentials.client_secret!,
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: `${process.env.NEXT_PUBLIC_API_URL || 'https://lpai-backend-omega.vercel.app'}/api/oauth/callback`
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }
      }
    );

    console.log('[OAuth Callback] Token response:', tokenResponse.data);
    console.log('[OAuth Debug] Token response data:', JSON.stringify(tokenResponse.data, null, 2));

    // Extract data from token response
    const { 
      access_token, 
      refresh_token, 
      expires_in, 
      locationId: tokenLocationId,
      userId,
      companyId: tokenCompanyId,
      userType,
      isBulkInstallation
    } = tokenResponse.data;

    // Get OAuth parameters from query
    const {
      locationId: queryLocationId,
      companyId: queryCompanyId,
      selectedLocations,
      approveAllLocations,
      excludedLocations
    } = req.query;

    const finalCompanyId = tokenCompanyId || queryCompanyId;
    const finalLocationId = tokenLocationId || queryLocationId;
    
    // ADD DEBUG LOGGING HERE
    console.log('[OAuth Callback] DEBUG - Token extraction results:');
    console.log('  - tokenLocationId from token response:', tokenLocationId);
    console.log('  - queryLocationId from URL params:', queryLocationId);
    console.log('  - finalLocationId resolved to:', finalLocationId);
    console.log('  - userType:', userType);
    console.log('  - Will enter location branch?', !!(tokenLocationId));
    
    console.log('[OAuth Callback] Parsed data:', {
      finalCompanyId,
      finalLocationId,
      userType,
      isBulkInstallation,
      selectedLocations,
      approveAllLocations
    });

    // Helper function to generate unique webhook IDs
    const generateWebhookId = (prefix: string, identifier: string): string => {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 9);
      return `${prefix}_${identifier}_${timestamp}_${random}`;
    };

    // Acquire install lock
    const lockKey = `oauth_${finalCompanyId}_${finalLocationId || 'company'}_${Date.now()}`;
    let lockAcquired = false;

    try {
      lockAcquired = await acquireInstallLock(
        db,
        finalCompanyId,
        finalLocationId,
        lockKey
      );

      if (!lockAcquired) {
        console.log(`[OAuth Callback] Install already in progress for ${finalLocationId || finalCompanyId}`);
        
        // Return a "processing" page that auto-refreshes
        const html = `
          <!DOCTYPE html>
          <html>
          <head>
            <title>Installation In Progress</title>
            <meta http-equiv="refresh" content="5">
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                margin: 0;
                background: #f5f5f5;
              }
              .container {
                background: white;
                padding: 40px;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                text-align: center;
                max-width: 500px;
              }
              h1 { color: #2E86AB; margin-bottom: 10px; }
              p { color: #666; line-height: 1.6; }
              .spinner {
                border: 3px solid #f3f3f3;
                border-top: 3px solid #2E86AB;
                border-radius: 50%;
                width: 40px;
                height: 40px;
                animation: spin 1s linear infinite;
                margin: 20px auto;
              }
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
              .details {
                background: #f0f0f0;
                padding: 15px;
                border-radius: 4px;
                margin: 20px 0;
                font-size: 14px;
                text-align: left;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>⏳ Installation In Progress</h1>
              <div class="spinner"></div>
              <p>Another installation is currently being processed for this location.</p>
              <div class="details">
                <strong>Location:</strong> ${finalLocationId || 'Company-level'}<br>
                <strong>Company:</strong> ${finalCompanyId || 'Unknown'}
              </div>
              <p>This page will refresh automatically every 5 seconds...</p>
            </div>
          </body>
          </html>
        `;

        res.setHeader('Content-Type', 'text/html');
        return res.status(200).send(html);
      }

      // Handle based on userType
      if (userType === 'Company' && !tokenLocationId) {
        // Company-level install
        console.log('[OAuth Callback] Company-level install detected');
        
        // Store company-level tokens
        await db.collection('locations').updateOne(
          { companyId: finalCompanyId, locationId: null },
          {
            $set: {
              companyId: finalCompanyId,
              ghlOAuth: {
                accessToken: access_token,
                refreshToken: refresh_token,
                expiresAt: new Date(Date.now() + (expires_in * 1000)),
                tokenType: 'Bearer',
                userType: 'Company',
                installedAt: new Date(),
                installedBy: userId,
                appType: 'fieldserv'
              },
              isCompanyLevel: true,
              updatedAt: new Date()
            },
            $setOnInsert: {
              locationId: null,
              name: 'Company-Level OAuth',
              createdAt: new Date()
            }
          },
          { upsert: true }
        );
        
        console.log('[OAuth Callback] Company tokens stored');
        
        // Find the specific location that was just installed
        let targetLocationId = null;
        
        // Method 1: Check URL parameters for selected location
        targetLocationId = queryLocationId || selectedLocations?.[0];
        
        // Method 2: If no location in URL, find recently installed location
        if (!targetLocationId) {
          console.log('[OAuth Callback] Looking for recently installed location...');
          
          const recentlyInstalled = await db.collection('locations').findOne({
            companyId: finalCompanyId,
            locationId: { $ne: null }, // Not the company record
            $or: [
              { 'ghlOAuth.accessToken': { $exists: false } }, // No OAuth tokens
              { appInstalled: { $ne: true } } // Not fully installed
            ]
          });
          
          if (recentlyInstalled) {
            targetLocationId = recentlyInstalled.locationId;
            console.log(`[OAuth Callback] Found recently installed location: ${targetLocationId}`);
          }
        }
        
        if (targetLocationId) {
          // Skip token fetch - just add to setup queue and redirect
          console.log('[OAuth Callback] Skipping location token fetch - will be handled by background queue');

          // Add to setup queue
          const webhookId = generateWebhookId('setup', targetLocationId);
          
          await db.collection('install_retry_queue').insertOne({
            _id: new ObjectId(),
            webhookId: webhookId,
            payload: {
              type: 'INSTALL',
              locationId: targetLocationId,
              companyId: finalCompanyId,
              isBulkInstallation: false
            },
            reason: 'oauth_callback_company_install',
            attempts: 0,
            status: 'pending',
            createdAt: new Date(),
            nextRetryAt: new Date()
          });
          
          console.log(`[OAuth Callback] Location ${targetLocationId} added to setup queue`);
          
          // Redirect to location-specific progress page
          const progressUrl = `https://leadprospecting.ai/progress/${targetLocationId}`;
          console.log('[OAuth Callback] Redirecting to location progress:', progressUrl);
          res.writeHead(302, { Location: progressUrl });
          return res.end();
        } else {
          // No specific location found - redirect to company page
          console.log('[OAuth Callback] No specific location found, showing company progress');
          
          const progressUrl = `https://leadprospecting.ai/progress/${finalCompanyId}`;
          res.writeHead(302, { Location: progressUrl });
          return res.end();
        }
        
      } else if (tokenLocationId || (userType === 'Location' && finalLocationId) || (userType === 'Location')) {
        // Location-level install (direct location install)
        const actualLocationId = tokenLocationId || finalLocationId;
        console.log('[OAuth Callback] Location-level install for:', actualLocationId);
        console.log('[OAuth Callback] DEBUG - tokenLocationId:', tokenLocationId, 'finalLocationId:', finalLocationId);
        
        // If we still don't have a location ID, this is an error case
        if (!actualLocationId) {
          console.error('[OAuth Callback] Location install detected but no location ID available');
          console.error('  - userType:', userType);
          console.error('  - tokenLocationId:', tokenLocationId);
          console.error('  - finalLocationId:', finalLocationId);
          throw new Error('Location install detected but no location ID available');
        }
        
        // Check if location exists, create if not
        const existingLocation = await db.collection('locations').findOne({
          locationId: actualLocationId
        });

        if (!existingLocation) {
          console.log('[OAuth Callback] Creating new location record');
          await db.collection('locations').insertOne({
            locationId: actualLocationId,
            companyId: finalCompanyId,
            name: 'New Location', // Will be updated by webhook
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }

        // Update location with OAuth tokens
        await db.collection('locations').updateOne(
          { locationId: actualLocationId },
          {
            $set: {
              ghlOAuth: {
                accessToken: access_token,
                refreshToken: refresh_token,
                expiresAt: new Date(Date.now() + (expires_in * 1000)),
                tokenType: 'Bearer',
                userType: userType || 'Location',
                installedAt: new Date(),
                installedBy: userId,
                appType: 'fieldserv'
              },
              companyId: finalCompanyId,
              hasLocationOAuth: true,
              updatedAt: new Date()
            },
            $unset: {
              uninstalledAt: "",      // Clear uninstall timestamp
              uninstallReason: "",    // Clear uninstall reason
              uninstallWebhookId: ""  // Clear uninstall webhook ID
            }
          }
        );

        console.log('[OAuth Callback] Location tokens stored for:', actualLocationId);
        
        // Add to setup queue for reliable processing
        const webhookId = generateWebhookId('setup', actualLocationId);
        
        await db.collection('install_retry_queue').insertOne({
          _id: new ObjectId(),
          webhookId: webhookId,
          payload: {
            type: 'INSTALL',
            locationId: actualLocationId,
            companyId: finalCompanyId,
            isBulkInstallation: false
          },
          reason: 'oauth_callback_location_install',
          attempts: 0,
          status: 'pending',
          createdAt: new Date(),
          nextRetryAt: new Date()
        });

        console.log('[OAuth Callback] Added to setup queue for reliable processing');

        // Create/update location record with progress structure for dashboard
        await db.collection('locations').updateOne(
          { locationId: actualLocationId },
          {
            $set: {
              syncProgress: {
                overall: { status: 'installing', progress: 0 },
                locationDetails: { status: 'pending' },
                pipelines: { status: 'pending' },
                calendars: { status: 'pending' },
                users: { status: 'pending' },
                contacts: { status: 'pending' },
                conversations: { status: 'pending' },
                invoices: { status: 'pending' },
                automationMapping: { status: 'pending' }
              },
              setupResults: {
                steps: {}
              },
              installationStatus: 'installing',
              progressDashboard: {
                visible: true,
                redirectUrl: `https://leadprospecting.ai/progress/${actualLocationId}`
              }
            }
          }
        );

        // Skip heavy processing in callback - let background queue handle it
        console.log('[OAuth Callback] Skipping immediate setup - will be handled by background queue');

        // Redirect to location progress page
        const progressUrl = `https://leadprospecting.ai/progress/${actualLocationId}`;
        console.log('[OAuth Callback] Redirecting to:', progressUrl);
        res.writeHead(302, { Location: progressUrl });
        return res.end();
      } else {
        // Unhandled case - log everything and show error
        console.error('[OAuth Callback] Unhandled OAuth flow case:');
        console.error('  - userType:', userType);
        console.error('  - tokenLocationId:', tokenLocationId);
        console.error('  - finalCompanyId:', finalCompanyId);
        console.error('  - finalLocationId:', finalLocationId);
        console.error('  - isBulkInstallation:', isBulkInstallation);
        console.error('  - Would construct URL:', `https://leadprospecting.ai/progress/${finalLocationId || finalCompanyId}`);
        
        throw new Error(`Unhandled OAuth flow: userType=${userType}, hasTokenLocationId=${!!tokenLocationId}, hasCompanyId=${!!finalCompanyId}`);
      }

    } finally {
      // Always release the lock when done
      if (lockAcquired) {
        await releaseInstallLock(db, finalCompanyId, finalLocationId, lockKey);
        console.log(`[OAuth Callback] Released lock for ${finalLocationId || finalCompanyId}`);
      }
    }

  } catch (error: any) {
    console.error('[OAuth Callback] Error:', error.response?.data || error);
    
    // Error page
    const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Installation Failed</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: #f5f5f5;
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 400px;
          }
          h1 { color: #E74C3C; margin-bottom: 10px; }
          p { color: #666; line-height: 1.6; }
          .error { 
            background: #fee; 
            padding: 15px; 
            border-radius: 4px; 
            color: #c00;
            margin: 20px 0;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Installation Failed</h1>
          <p>There was an error installing the LPai App.</p>
          <div class="error">${error.response?.data?.error || error.message || 'Unknown error occurred'}</div>
          <p>Please try again or contact support if the problem persists.</p>
        </div>
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    return res.status(500).send(errorHtml);
  }
}


// NEW: Installation setup function
async function processInstallationSetup(locationId: string, companyId: string) {
  console.log(`[Installation Setup] Starting for location: ${locationId}`);
  
  const client = await clientPromise;
  const db = client.db('lpai');
  
  try {
    // 1. Get location details and send welcome email
    const location = await db.collection('locations').findOne({ locationId });
    
    // 2. Update location with comprehensive default settings
    if (location) {
      await db.collection('locations').updateOne(
        { locationId },
        {
          $set: {
            // Default settings based on your structure
            settings: {
              allowDuplicateContact: false,
              allowDuplicateOpportunity: true,
              allowFacebookNameMerge: false,
              disableContactTimezone: false,
              contactUniqueIdentifiers: ["email", "phone"]
            },
            
            // Default pipeline settings
            pipelineSettings: {
              projectsPipelines: [],
              quotesPipelines: [],
              stageIcons: {},
              updatedAt: new Date()
            },
            
            // Default calendar settings
            calendarSettings: {
              projectsCalendars: [],
              quotesCalendars: [],
              displayCalendars: [],
              updatedAt: new Date()
            },
            
            // Default terms and conditions
            termsAndConditions: "Terms and Conditions:\n1. Acceptance of Estimate:\nBy signing this Agreement, Customer acknowledges acceptance of the terms, scope of work, and pricing as detailed in the estimate provided by {companyName}.\n\n2. Payment Terms:\nFull payment is due upon project completion.",
            
            // Setup tracking
            defaultsSetup: true,
            defaultsSetupAt: new Date(),
            updatedAt: new Date()
          }
        }
      );
    }
    
    if (location && location.email) {
      // Send installation welcome email (no password setup - that's for individual users)
      await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://lpai-backend-omega.vercel.app'}/api/emails/welcomeEmail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: location.email,
          firstName: location.contactFirstName || location.firstName || (location.email ? location.email.split('@')[0] : 'User'),
          businessName: location.name,
          customMessage: `Your FieldServ Ai installation for ${location.name} is complete! All users will receive individual emails shortly with password setup instructions.`
        })
      });
      
      console.log(`[Installation Setup] Welcome email sent to ${location.email}`);
    }

    // 3. Create GHL objects and capture IDs FIRST
    await createGHLObjectsAndCaptureIDs(locationId, location);


    // 5. Users will be synced later in setup-location.ts - removed duplicate sync
    console.log(`[Installation Setup] User sync will happen in setup-location flow`);

    // 4. Mark installation as complete
    await db.collection('locations').updateOne(
      { locationId },
      {
        $set: {
          installationStatus: 'completed',
          installationCompletedAt: new Date(),
          isFullySetup: true
        }
      }
    );

    console.log(`[Installation Setup] Completed for location: ${locationId}`);

  } catch (error) {
    console.error(`[Installation Setup] Error for ${locationId}:`, error);
    
    // Mark as failed but don't crash the main flow
    await db.collection('locations').updateOne(
      { locationId },
      {
        $set: {
          installationStatus: 'failed',
          installationError: error.message,
          installationFailedAt: new Date()
        }
      }
    );
  }
}

// Template installation moved to createPipelineCalendarRecordsAndMapAutomations.ts
// This ensures templates are installed after full sync with real pipeline/calendar data

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
  const db = client.db('lpai');
  
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
