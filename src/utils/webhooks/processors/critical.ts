// src/utils/webhooks/processors/critical.ts
import { BaseProcessor } from './base';
import { QueueItem } from '../queueManager';
import { ObjectId, Db } from 'mongodb';
import { generateSecureToken } from '../../security/tokenGenerator';
import { sendWelcomeEmail } from '../../email/welcomeEmail';

export class CriticalProcessor extends BaseProcessor {
  constructor(db?: Db) {
    super({
      queueType: 'critical',
      batchSize: 10, // Smaller batches for critical items
      maxRuntime: 50000, // 50 seconds
      processorName: 'CriticalProcessor'
    }, db);
  }

  /**
   * Process critical webhook types
   */
  protected async processItem(item: QueueItem): Promise<void> {
    const { type, payload, webhookId } = item;

    switch (type) {
      case 'INSTALL':
        await this.processInstall(payload, webhookId);
        break;
        
      case 'UNINSTALL':
        await this.processUninstall(payload, webhookId);
        break;
        
      case 'PLAN_CHANGE':
        await this.processPlanChange(payload, webhookId);
        break;
        
      case 'UserCreate':
        await this.processUserCreate(payload, webhookId);
        break;
        
      default:
        console.warn(`[CriticalProcessor] Unknown critical type: ${type}`);
        throw new Error(`Unsupported critical webhook type: ${type}`);
    }
  }

  /**
   * Process user creation with welcome email
   */
  private async processUserCreate(payload: any, webhookId: string): Promise<void> {
    const startTime = Date.now();
    
    // Handle nested structure
    let userData;
    let locationId;
    
    if (payload.webhookPayload) {
      userData = payload.webhookPayload;
      locationId = payload.locationId || userData.locationId;
    } else {
      userData = payload;
      locationId = payload.locationId;
    }
    
    const user = userData.user || userData;
    
    console.log(`[CriticalProcessor] Processing UserCreate for ${user.email}`);
    
    // Check if user already exists
    const existingUser = await this.db.collection('users').findOne({
      $or: [
        { ghlUserId: user.id },
        { email: user.email, locationId }
      ]
    });

    if (!existingUser) {
      // Generate setup token for new user
      const setupToken = generateSecureToken();
      const setupTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      
      // Create user with all fields
      const newUser = {
        _id: new ObjectId(),
        ghlUserId: user.id,
        locationId,
        email: user.email,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        phone: user.phone || '',
        role: user.role || user.type || 'user',
        permissions: user.permissions || ['read'],
        extension: user.extension || null,
        
        // Setup fields
        setupToken,
        setupTokenExpiry,
        needsSetup: true,
        hashedPassword: null,
        needsPasswordReset: false,
        onboardingStatus: 'pending',
        
        // Metadata
        createdAt: new Date(),
        createdByWebhook: webhookId,
        lastWebhookUpdate: new Date(),
        isActive: true,
        
        // Default preferences
        preferences: {
          notifications: true,
          defaultCalendarView: 'week',
          emailSignature: '',
          theme: 'system',
          timezone: 'America/Denver',
          dateFormat: 'MM/DD/YYYY',
          timeFormat: '12h',
          firstDayOfWeek: 0,
          language: 'en'
        }
      };

      await this.db.collection('users').insertOne(newUser);
      
      // CRITICAL FIX: Schedule email for later instead of sending immediately
      await this.db.collection('email_queue').insertOne({
        _id: new ObjectId(),
        type: 'welcome_email',
        userId: newUser._id,
        email: user.email,
        firstName: user.firstName || user.email.split('@')[0] || 'User',
        locationId,
        setupToken,
        setupUrl: `https://www.leadprospecting.ai/setup-password?token=${setupToken}`,
        scheduledFor: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes delay
        status: 'pending',
        createdAt: new Date(),
        webhookId
      });
      
      console.log(`[CriticalProcessor] Welcome email scheduled for: ${user.email}`);
      
      const duration = Date.now() - startTime;
      console.log(`[CriticalProcessor] User created in ${duration}ms`);
    } else {
      // Update existing user
      await this.db.collection('users').updateOne(
        { _id: existingUser._id },
        {
          $set: {
            firstName: user.firstName || existingUser.firstName,
            lastName: user.lastName || existingUser.lastName,
            name: user.name || existingUser.name,
            phone: user.phone || existingUser.phone,
            role: user.role || existingUser.role,
            permissions: user.permissions || existingUser.permissions,
            lastWebhookUpdate: new Date()
          }
        }
      );
      
      console.log(`[CriticalProcessor] Updated existing user: ${user.email}`);
    }
  }

 /**
 * Process app installation
 */
private async processInstall(payload: any, webhookId: string): Promise<void> {
  const { installType, locationId, companyId, userId, companyName, planId } = payload;
  
  console.log(`[CriticalProcessor] Processing ${installType} install for ${locationId || companyId}`);

  // Track install start time
  const installStartTime = Date.now();
  
  // Update metrics with install steps
  await this.db.collection('webhook_metrics').updateOne(
    { webhookId },
    { 
      $set: { 
        'timestamps.steps.installStarted': new Date(),
        'installType': installType
      } 
    }
  );

  if (installType === 'Location' && locationId) {
    // Check if we need to fetch OAuth tokens for this location
    const location = await this.db.collection('locations').findOne({ locationId });
    
    if (!location?.ghlOAuth?.accessToken && companyId) {
      console.log(`[CriticalProcessor] No OAuth token found for location ${locationId}, fetching from company...`);
      
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || 'https://lpai-backend-omega.vercel.app'}/api/oauth/get-location-tokens`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              companyId: companyId,
              locationId: locationId
            })
          }
        );
        
        if (response.ok) {
          console.log(`[CriticalProcessor] Location OAuth token fetched successfully`);
        } else {
          console.error(`[CriticalProcessor] Failed to fetch location token: ${response.status}`);
        }
      } catch (error) {
        console.error(`[CriticalProcessor] Error fetching location token:`, error);
      }
    }
    
    await this.processLocationInstall({
      locationId,
      companyId,
      userId,
      companyName,
      planId,
      webhookId,
      timestamp: payload.timestamp
    });
  } else if (installType === 'Company' && companyId) {
    await this.processCompanyInstall({
      companyId,
      companyName,
      planId,
      webhookId,
      timestamp: payload.timestamp
    });
  }


    // Update metrics with completion
    const installDuration = Date.now() - installStartTime;
    await this.db.collection('webhook_metrics').updateOne(
      { webhookId },
      { 
        $set: { 
          'timestamps.steps.installCompleted': new Date(),
          'metrics.stepDurations.totalInstall': installDuration
        } 
      }
    );

    console.log(`[CriticalProcessor] Install completed in ${installDuration}ms`);
  }

  /**
   * Process location-specific installation
   */
  private async processLocationInstall(params: {
    locationId: string;
    companyId: string;
    userId: string;
    companyName?: string;
    planId?: string;
    webhookId: string;
    timestamp?: Date;
  }): Promise<void> {
    const { locationId, companyId, userId, companyName, planId, webhookId, timestamp } = params;

    // Use session for atomic operations
    const session = this.client.startSession();
    
    try {
      await session.withTransaction(async () => {
        // Update or create location
        await this.db.collection('locations').updateOne(
          { locationId },
          {
            $set: {
              appInstalled: true,
              installedAt: new Date(timestamp || Date.now()),
              installedBy: userId,
              installWebhookId: webhookId,
              installPlanId: planId,
              companyId,
              companyName,
              updatedAt: new Date()
            },
            $unset: {
              uninstalledAt: "",
              uninstalledBy: "",
              uninstallReason: "",
              uninstallWebhookId: ""
            },
            $setOnInsert: {
              _id: new ObjectId(),
              locationId,
              createdAt: new Date()
            }
          },
          { upsert: true, session }
        );


        // Track install event
        await this.db.collection('app_events').insertOne({
          _id: new ObjectId(),
          type: 'install',
          entityType: 'location',
          entityId: locationId,
          companyId,
          userId,
          planId,
          webhookId,
          timestamp: new Date(timestamp || Date.now()),
          metadata: {
            companyName,
            installType: 'location'
          }
        }, { session });
      });

      // Queue location setup (outside transaction)
      await this.queueLocationSetup(locationId, webhookId);
      
    } finally {
      await session.endSession();
    }
  }

  /**
   * Process company-wide installation
   */
  private async processCompanyInstall(params: {
    companyId: string;
    companyName?: string;
    planId?: string;
    webhookId: string;
    timestamp?: Date;
  }): Promise<void> {
    const { companyId, companyName, planId, webhookId, timestamp } = params;

    // Track company install
    await this.db.collection('app_events').insertOne({
      _id: new ObjectId(),
      type: 'install',
      entityType: 'company',
      entityId: companyId,
      companyId,
      planId,
      webhookId,
      timestamp: new Date(timestamp || Date.now()),
      metadata: {
        companyName,
        installType: 'company'
      }
    });

    // Queue sync job for all company locations
    await this.db.collection('sync_queue').insertOne({
      _id: new ObjectId(),
      type: 'SYNC_AGENCY',
      companyId,
      status: 'pending',
      priority: 3,
      createdAt: new Date(),
      metadata: {
        installWebhookId: webhookId,
        planId,
        source: 'company_install'
      }
    });

    console.log(`[CriticalProcessor] Company install tracked for ${companyId}`);
  }

    /**
     * Queue location setup in install retry queue
     */
    private async queueLocationSetup(locationId: string, webhookId: string): Promise<void> {
      try {
        // Create a unique ID for this setup task
        const setupId = new ObjectId();
        
        await this.db.collection('install_retry_queue').insertOne({
          _id: setupId,
          // Use the ObjectId as webhookId to ensure uniqueness
          webhookId: setupId.toString(),
          type: 'SETUP_LOCATION',
          payload: {
            type: 'SETUP_LOCATION',
            locationId,
            fullSync: true,
            originalWebhookId: webhookId
          },
          status: 'pending',
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
          nextRetryAt: new Date() // Process immediately
        });

        // Update location to indicate setup is queued
        await this.db.collection('locations').updateOne(
          { locationId },
          {
            $set: {
              setupQueued: true,
              setupQueuedAt: new Date(),
              lastSetupWebhook: webhookId
            }
          }
        );

        console.log(`[CriticalProcessor] Setup queued successfully for ${locationId}`);

      } catch (error: any) {
        console.error(`[CriticalProcessor] Failed to queue setup for ${locationId}:`, error);
        
        // Mark location as needing manual setup
        await this.db.collection('locations').updateOne(
          { locationId },
          {
            $set: {
              setupError: error.message,
              needsManualSetup: true,
              setupFailedAt: new Date()
            }
          }
        );

        // Don't throw - install succeeded even if queuing failed
      }
    }
/**
 * Process app uninstallation
 */
private async processUninstall(payload: any, webhookId: string): Promise<void> {
  const { locationId, companyId, userId, reason, timestamp } = payload;
  
  console.log(`[CriticalProcessor] Processing uninstall for ${locationId || companyId}`);

  if (locationId) {
    // Location-specific uninstall
    await this.db.collection('locations').updateOne(
      { locationId },
      {
        $set: {
          appInstalled: false,
          uninstalledAt: new Date(timestamp || Date.now()),
          uninstalledBy: userId,
          uninstallReason: reason || 'User uninstalled',
          uninstallWebhookId: webhookId,
          updatedAt: new Date()
        },
        $unset: {
          // OAuth cleanup
          ghlOAuth: "",
          hasLocationOAuth: "",
          hasCompanyOAuth: "",
          
          // Installation data cleanup
          installedAt: "",
          installedBy: "",
          installWebhookId: "",
          installType: "",
          installPlanId: "",
          
          // Setup data cleanup
          setupCompleted: "",
          setupCompletedAt: "",
          setupQueued: "",
          setupQueuedAt: "",
          lastSetupRun: "",
          lastSetupWebhook: "",
          setupResults: "",
          
          // Sync progress cleanup
          syncProgress: "",
          contactSyncStatus: "",
          lastContactSync: "",
          conversationSyncStatus: "",
          lastConversationSync: "",
          appointmentSyncStatus: "",
          lastAppointmentSync: "",
          lastInvoiceSync: "",
          
          // Company approval cleanup
          approvedViaCompany: ""
        }
      }
    );

    // Initialize cleanup results tracking
    const cleanupResults = {
      automations: 0,
      smsTemplates: 0,
      emailTemplates: 0,
      pipelineRecords: 0,
      calendarRecords: 0,
      queueItems: 0,
      executionRecords: 0,
      users: 0,
      appointments: 0,
      projects: 0,
      templates: 0,
      webhookQueue: 0
    };

    // 1. DELETE INDIVIDUAL COLLECTION RECORDS BY LOCATION
    
    // Delete ALL automation_rules for this location (no source filter - that field doesn't exist!)
    const automationResult = await this.db.collection('automation_rules').deleteMany({
      locationId
    });
    cleanupResults.automations = automationResult.deletedCount;

    // Delete SMS templates
    const smsTemplatesResult = await this.db.collection('sms_templates').deleteMany({
      locationId
    });
    cleanupResults.smsTemplates = smsTemplatesResult.deletedCount;

    // Delete email templates
    const emailTemplatesResult = await this.db.collection('email_templates').deleteMany({
      locationId
    });
    cleanupResults.emailTemplates = emailTemplatesResult.deletedCount;

    // Delete individual pipeline records  
    const pipelineRecordsResult = await this.db.collection('pipelines').deleteMany({
      locationId
    });
    
    // Delete individual calendar records
    const calendarRecordsResult = await this.db.collection('calendars').deleteMany({
      locationId
    });

    // Delete automation_queue items
    const queueResult = await this.db.collection('automation_queue').deleteMany({
      'trigger.locationId': locationId
    });

    // Delete automation_executions
    const executionResult = await this.db.collection('automation_executions').deleteMany({
      locationId
    });

    // HARD DELETE users - clean slate for reinstall
    const userResult = await this.db.collection('users').deleteMany({
      locationId
    });
    cleanupResults.users = userResult.deletedCount;

    // Delete future appointments only
    const appointmentResult = await this.db.collection('appointments').deleteMany({
      locationId,
      start: { $gte: new Date() },
      status: { $nin: ['completed', 'no-show'] }
    });
    cleanupResults.appointments = appointmentResult.deletedCount;

    // Soft delete recent projects (preserve completed ones)
    const recentDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const projectResult = await this.db.collection('projects').updateMany(
      { 
        locationId,
        createdAt: { $gte: recentDate },
        status: { $in: ['draft', 'pending', 'quoted'] }
      },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedReason: 'app_uninstall'
        }
      }
    );
    cleanupResults.projects = projectResult.modifiedCount;

    // Delete templates from templates collection
    const templateResult = await this.db.collection('templates').deleteMany({
      locationId,
      source: 'auto_install'
    });
    cleanupResults.templates = templateResult.deletedCount;

    // Delete webhook queue items for this location
    const webhookResult = await this.db.collection('webhook_queue').deleteMany({
      $or: [
        { 'payload.locationId': locationId },
        { 'trigger.locationId': locationId }
      ],
      status: { $in: ['pending', 'processing'] }
    });
    cleanupResults.webhookQueue = webhookResult.deletedCount;

    // Delete any processor logs for this location 
    await this.db.collection('processor_logs').deleteMany({
      locationId
    });

    // Update cleanup results with all the deletions
    cleanupResults.pipelineRecords = pipelineRecordsResult.deletedCount;
    cleanupResults.calendarRecords = calendarRecordsResult.deletedCount;
    cleanupResults.queueItems = queueResult.deletedCount;
    cleanupResults.executionRecords = executionResult.deletedCount;

    // Log comprehensive cleanup results
    console.log(`[CriticalProcessor] Uninstall cleanup completed for ${locationId}:`, cleanupResults);

    // Force logout all users via Ably
    const usersToLogout = await this.db.collection('users').find({
      'locations.locationId': new ObjectId(locationId),
      isDeleted: { $ne: true }
    }).toArray();

    console.log(`[LocationUninstall] Found ${usersToLogout.length} users to force logout`);

    // Send force logout to each user via Ably
    const Ably = require('ably');
    const ably = new Ably.Rest(process.env.ABLY_API_KEY);

    for (const user of usersToLogout) {
      try {
        const channel = ably.channels.get(`user:${user._id}`);
        await channel.publish('force-logout', {
          reason: 'location_uninstalled',
          locationId,
          timestamp: new Date()
        });
        console.log(`[LocationUninstall] Sent force-logout to user ${user._id}`);
      } catch (err) {
        console.error(`[LocationUninstall] Failed to send force-logout to user ${user._id}:`, err);
      }
    }
  } // <-- This closes the if (locationId) block

  // Track uninstall event
  await this.db.collection('app_events').insertOne({
    _id: new ObjectId(),
    type: 'uninstall',
    entityType: locationId ? 'location' : 'company',
    entityId: locationId || companyId,
    companyId,
    userId,
    reason,
    webhookId,
    timestamp: new Date(timestamp || Date.now())
  });

  console.log(`[CriticalProcessor] Uninstall processed successfully`);
}

/**
 * Process plan change
 */
private async processPlanChange(payload: any, webhookId: string): Promise<void> {
  const { locationId, companyId, oldPlanId, newPlanId, userId, timestamp } = payload;
  
  console.log(`[CriticalProcessor] Processing plan change from ${oldPlanId} to ${newPlanId}`);

  // Track plan change event
  await this.db.collection('app_events').insertOne({
    _id: new ObjectId(),
    type: 'plan_change',
    entityType: locationId ? 'location' : 'company',
    entityId: locationId || companyId,
    companyId,
    userId,
    oldPlanId,
    newPlanId,
    webhookId,
    timestamp: new Date(timestamp || Date.now())
  });

  // Update location if applicable
  if (locationId) {
    await this.db.collection('locations').updateOne(
      { locationId },
      {
        $set: {
          currentPlanId: newPlanId,
          planChangedAt: new Date(),
          updatedAt: new Date()
        }
      }
    );
  }

  console.log(`[CriticalProcessor] Plan change processed successfully`);
}}