// `src/services/automationEventListener.ts`:
import { eventBus } from './eventBus';
import { Db, ObjectId } from 'mongodb';
import crypto from 'crypto';

// Generate unique hash for deduplication
function generateTriggerHash(trigger: any, ruleId: string): string {
  const hashData = {
    ruleId,
    triggerType: trigger.type,
    projectId: trigger.data?.projectId,
    contactId: trigger.data?.contactId,
    stageId: trigger.stageId || trigger.data?.stageId,
    timeWindow: Math.floor(Date.now() / (5 * 60 * 1000)) // 5-minute window
  };
  
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(hashData))
    .digest('hex');
}

export class AutomationEventListener {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
    this.setupListeners();
  }

  private setupListeners() {
    // Listen for contact events
    eventBus.on('contact.created', async (event) => {
      await this.handleContactCreated(event);
    });

    eventBus.on('contact.updated', async (event) => {
      await this.handleContactUpdated(event);
    });

    // Listen for project events
    eventBus.on('project.stage.changed', async (event) => {
      await this.handleStageChange(event);
    });

    eventBus.on('project-created', async (event) => {
      await this.handleProjectCreated(event);
    });

    eventBus.on('contact-assigned', async (event) => {
      await this.handleContactAssigned(event);
    });

    // ✅ ADD PAYMENT AND QUOTE EVENT LISTENERS
    eventBus.on('payment-received', async (event) => {
      await this.handlePaymentReceived(event);
    });

    eventBus.on('quote-signed', async (event) => {
      await this.handleQuoteSigned(event);
    });

    eventBus.on('quote-expired', async (event) => {
      await this.handleQuoteExpired(event);
    });

    eventBus.on('quote-viewed', async (event) => {
      await this.handleQuoteViewed(event);
    });

    // ✅ ADD APPOINTMENT EVENT LISTENERS
    eventBus.on('appointment-scheduled', async (event) => {
      await this.handleAppointmentScheduled(event);
    });

    eventBus.on('appointment-completed', async (event) => {
      await this.handleAppointmentCompleted(event);
    });

    eventBus.on('appointment-noshow', async (event) => {
      await this.handleAppointmentNoShow(event);
    });

    eventBus.on('appointment-rescheduled', async (event) => {
      await this.handleAppointmentRescheduled(event);
    });

    // ✅ ADD COMMUNICATION EVENT LISTENERS
    eventBus.on('sms-received', async (event) => {
      await this.handleSmsReceived(event);
    });

    eventBus.on('email-opened', async (event) => {
      await this.handleEmailOpened(event);
    });

    eventBus.on('form-submitted', async (event) => {
      await this.handleFormSubmitted(event);
    });

    eventBus.on('review-received', async (event) => {
      await this.handleReviewReceived(event);
    });

    eventBus.on('contact-assigned', async (event) => {
      await this.handleContactAssigned(event);
    });

    console.log('✅ Automation event listeners initialized');
  }

  private async handleContactCreated(event: any) {
    // Only process if there are automation rules for contact creation
    const rules = await this.db.collection('automation_rules').find({
      locationId: event.data.locationId,
      isActive: true,
      'trigger.type': 'contact-created'
    }).toArray();

    if (rules.length === 0) return; // No rules, skip

    for (const rule of rules) {
      await this.queueAutomation(rule, event);
    }
  }

  private async handleContactUpdated(event: any) {
    // Only process if there are automation rules for contact updates
    const rules = await this.db.collection('automation_rules').find({
      locationId: event.data.locationId,
      isActive: true,
      'trigger.type': 'contact-updated'
    }).toArray();

    if (rules.length === 0) return; // No rules, skip

    for (const rule of rules) {
      await this.queueAutomation(rule, event);
    }
  }

  private async handleStageChange(event: any) {
    console.log('🔍 [handleStageChange] Event data:', JSON.stringify(event.data, null, 2));
    
    // Handle immediate stage-entered triggers
    const immediateRules = await this.db.collection('automation_rules').find({
      locationId: event.data.locationId,
      isActive: true,
      'trigger.type': 'stage-entered',
      stageId: event.data.newStage || event.data.toStageId
    }).toArray();

    // FIXED: Handle both MongoDB ObjectId and GHL opportunity ID formats
    let project = null;
    if (event.data.projectId) {
      // Check if it's a valid MongoDB ObjectId (24 hex characters)
      if (/^[a-fA-F0-9]{24}$/.test(event.data.projectId)) {
        project = await this.db.collection('projects').findOne({ _id: new ObjectId(event.data.projectId) });
      } else {
        // It's probably a GHL opportunity ID, search by ghlOpportunityId
        project = await this.db.collection('projects').findOne({ 
          ghlOpportunityId: event.data.projectId,
          locationId: event.data.locationId 
        });
      }
      
      console.log('🔍 [handleStageChange] Project lookup result:', {
        searchedFor: event.data.projectId,
        isObjectId: /^[a-fA-F0-9]{24}$/.test(event.data.projectId),
        projectFound: !!project,
        projectId: project?._id,
        ghlOpportunityId: project?.ghlOpportunityId
      });
    }

    const contact = project?.contactId ? 
      await this.db.collection('contacts').findOne({ _id: new ObjectId(project.contactId) }) : null;

    for (const rule of immediateRules) {
      await this.queueAutomation(rule, {
        type: 'stage-entered',
        data: {
          projectId: event.data.projectId,
          contactId: project?.contactId,
          fromStageId: event.data.fromStageId,
          toStageId: event.data.toStageId,
          pipelineId: event.data.pipelineId,
          stageEntryDate: new Date(),
          projectValue: project?.monetaryValue,
          projectStatus: project?.status,
          project,
          contact,
          locationId: event.data.locationId
        },
        timestamp: new Date()
      });
    }

    // NEW: Handle stage-delay triggers by pre-scheduling them
    const delayRules = await this.db.collection('automation_rules').find({
      locationId: event.data.locationId,
      isActive: true,
      'trigger.type': 'stage-delay',
      stageId: event.data.newStage || event.data.toStageId
    }).toArray();

    console.log(`Found ${delayRules.length} stage-delay rules for stage ${event.data.newStage || event.data.toStageId}`);

    for (const rule of delayRules) {
      const delayMs = rule.trigger.config.delayAmount * 
        (rule.trigger.config.delayUnit === 'minutes' ? 60000 : 
         rule.trigger.config.delayUnit === 'hours' ? 3600000 : 86400000);

      const triggerTime = new Date(Date.now() + delayMs);

      // Schedule each action
      for (const action of rule.actions) {
        await this.db.collection('automation_queue').insertOne({
          ruleId: rule._id,
          action,
          actionType: action.type,
          trigger: {
            type: 'stage-delay',
            locationId: event.data.locationId,
            data: event.data
          },
          status: 'scheduled',
          scheduledFor: triggerTime,
          createdAt: new Date(),
          attempts: 0,
          metadata: {
            stageId: event.data.newStage || event.data.toStageId,
            delayAmount: rule.trigger.config.delayAmount,
            delayUnit: rule.trigger.config.delayUnit,
            projectId: event.data.projectId
          }
        });
      }

      console.log(`Scheduled stage-delay automation ${rule.name} for ${triggerTime.toISOString()}`);
    }
  }

  // Add cleanup method for stage changes
  async emitStageExited(event: any) {
    try {
      console.log(`Cleaning up stage-delay automations for project ${event.data.projectId} leaving stage ${event.data.fromStageId}`);
      
      // When project moves OUT of a stage, clean up any pending stage-delay automations
      const deleteResult = await this.db.collection('automation_queue').deleteMany({
        'metadata.projectId': event.data.projectId,
        'trigger.type': 'stage-delay',
        status: 'scheduled'
      });

      console.log(`Cleaned up ${deleteResult.deletedCount} scheduled stage-delay automations for project ${event.data.projectId}`);
    } catch (error) {
      console.error('Error cleaning up stage-delay automations:', error);
    }
  }

  private async handleContactAssigned(event: any) {
    // Check for duplicate contact-assigned events in last 10 seconds
    const recentDuplicate = await this.db.collection('automation_queue').findOne({
      'trigger.type': 'contact-assigned',
      'trigger.locationId': event.locationId,
      'trigger.data.contactId': event.contactId,
      'trigger.data.assignedTo': event.assignedTo,
      createdAt: { $gte: new Date(Date.now() - 10000) } // Last 10 seconds
    });
    
    if (recentDuplicate) {
      console.log(`[AutomationEventListener] Duplicate contact-assigned event for contact ${event.contactId}, skipping`);
      return;
    }

    // Find automation rules for contact assignment
    const rules = await this.db.collection('automation_rules').find({
      locationId: event.locationId,
      isActive: true,
      'trigger.type': 'contact-assigned'
    }).toArray();

    if (rules.length === 0) return;

    for (const rule of rules) {
      await this.queueAutomation(rule, {
        type: 'contact-assigned',
        data: event,
        timestamp: new Date()
      });
    }
  }

  private async handleProjectCreated(event: any) {
    // Check if we already processed this project creation
    const existingTrigger = await this.db.collection('automation_queue').findOne({
      'trigger.type': 'project-created',
      'trigger.data.projectId': event.data?.projectId || event.projectId,
      createdAt: { $gte: new Date(Date.now() - 60000) } // Within last minute
    });
    
    if (existingTrigger) {
      console.log(`Duplicate project-created event detected for ${event.data?.projectId}, skipping`);
      return;
    }
    
    // Only process if there are automation rules for project creation
    const rules = await this.db.collection('automation_rules').find({
      locationId: event.data?.locationId || event.locationId,
      isActive: true,
      'trigger.type': 'project-created'
    }).toArray();

    if (rules.length === 0) return; // No rules, skip

    for (const rule of rules) {
      await this.queueAutomation(rule, event);
    }
  }

  async emitContactTagged(contact: any, tagsAdded: string[], tagsRemoved: string[]) {
    try {
      // Find automation rules for contact tagged
      const rules = await this.db.collection('automation_rules').find({
        locationId: contact.locationId,
        isActive: true,
        'trigger.type': 'contact-tagged'
      }).toArray();

      if (rules.length === 0) return;

      for (const rule of rules) {
        await this.queueAutomation(rule, {
          type: 'contact-tagged',
          data: {
            contactId: contact._id.toString(),
            tagsAdded,
            tagsRemoved,
            contact,
            contactTags: contact.tags || [],
            contactSource: contact.source,
            contactType: contact.type,
            assignedUserId: contact.assignedTo,
            customFields: contact.customFields || {},
            lastActivityDate: contact.lastActivityDate,
            contactScore: contact.score,
            createdDate: contact.createdAt,
            locationId: contact.locationId
          },
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error emitting contact-tagged:', error);
    }
  }

  async emitContactCreated(contact: any) {
    try {
      // Find automation rules for contact created
      const rules = await this.db.collection('automation_rules').find({
        locationId: contact.locationId,
        isActive: true,
        'trigger.type': 'contact-created'
      }).toArray();

      if (rules.length === 0) return;

      for (const rule of rules) {
        await this.queueAutomation(rule, {
          type: 'contact-created',
          data: {
            contactId: contact._id.toString(),
            contact,
            source: contact.source || 'ghl-webhook',
            contactTags: contact.tags || [],
            contactSource: contact.source,
            contactType: contact.type,
            assignedUserId: contact.assignedTo,
            customFields: contact.customFields || {},
            lastActivityDate: contact.lastActivityDate,
            contactScore: contact.score,
            createdDate: contact.createdAt,
            locationId: contact.locationId
          },
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error emitting contact-created:', error);
    }
  }

  private generateTriggerHash(event: any, ruleId: string): string {
    // Create a unique hash based on the event data WITHOUT timestamps
    const hashData = {
      ruleId,
      triggerType: event.type,
      projectId: event.data?.projectId || event.data?.project?._id,
      contactId: event.data?.contactId || event.data?.contact?._id,
      locationId: event.data?.locationId,
      // Don't include timestamps to avoid duplicate triggers
    };
    
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(hashData))
      .digest('hex');
  }

  private async queueAutomation(rule: any, event: any) {
    const triggerHash = this.generateTriggerHash(event, rule._id.toString());
    
    // Process each action in the rule
    for (const action of rule.actions) {
      // Calculate delay first to determine deduplication window
      const delayAmount = action.config?.delay?.amount ?? 0;
      const delayUnit = action.config?.delay?.unit || 'minutes';
      
      // Generate unique hash for this specific action INCLUDING the actual event data
      const actionHash = crypto
        .createHash('sha256')
        .update(JSON.stringify({
          triggerHash,
          actionType: action.type,
          // Remove timestamp to prevent duplicates
          projectId: event.data?.projectId || event.data?.project?._id,
          contactId: event.data?.contactId || event.data?.contact?._id,
          // Use a 5-minute time window for uniqueness instead
          timeWindow: Math.floor(Date.now() / (5 * 60 * 1000))
        }))
        .digest('hex');
      
      // Shorter dedup window for push notifications (30 seconds), longer for others
      const dedupWindowMs = action.type === 'push-notification' ? 30 * 1000 : 10 * 60 * 1000;

      const existingAction = await this.db.collection('automation_queue').findOne({
        'metadata.actionHash': actionHash,
        status: { $in: ['pending', 'scheduled', 'processing'] },
        createdAt: { $gte: new Date(Date.now() - dedupWindowMs) }
      });
      
      if (existingAction) {
        console.log(`Duplicate action detected, skipping: ${action.type} - ${actionHash}`);
        continue;
      }
      
      // Now create the queue entry
      const queueEntry: any = {
        ruleId: rule._id.toString(),
        action,
        actionType: action.type,
        trigger: {
          type: event.type,
          locationId: rule.locationId,
          // CRITICAL FIX: Include root-level fields in data
          data: {
            ...event.data,
            // Explicitly include depositAmount from root level
            depositAmount: event.depositAmount ?? event.data?.depositAmount ?? event.data?.quoteDepositAmount ?? 0,
            depositRequired: event.depositRequired ?? event.data?.depositRequired ?? event.data?.quoteDepositRequired ?? false
          }
        },
        status: 'pending',
        scheduledFor: undefined,
        createdAt: new Date(),
        attempts: 0,
        metadata: { 
          triggerHash,
          actionHash
        }
      };
      
      // Set status and scheduledFor based on delay
      if (delayAmount > 0) {
        const delayMs = delayAmount * 
          (delayUnit === 'minutes' ? 60000 : 
           delayUnit === 'hours' ? 3600000 : 86400000);
        queueEntry.status = 'scheduled';
        queueEntry.scheduledFor = new Date(Date.now() + delayMs);
      } else {
        queueEntry.status = 'pending';
        queueEntry.scheduledFor = new Date();
      }

      await this.db.collection('automation_queue').insertOne(queueEntry);
    }
  }

  private calculateActionDelay(action: any, eventData?: any): number {
    const delayConfig = action.config?.delay;
    if (!delayConfig) return 0;
    
    const { amount, unit, relativeToField } = delayConfig;
    if (!amount || !unit) return 0;
    
    const multipliers: { [key: string]: number } = {
      'minutes': 60 * 1000,
      'hours': 60 * 60 * 1000,
      'days': 24 * 60 * 60 * 1000,
      'weeks': 7 * 24 * 60 * 60 * 1000
    };
    
    let baseTime = Date.now();
    
    // Handle relative timing (e.g., "24 hours before appointment")
    if (relativeToField && eventData) {
      const fieldValue = this.getNestedValue(eventData, relativeToField);
      if (fieldValue) {
        baseTime = new Date(fieldValue).getTime();
      }
    }
    
    const delayMs = amount * (multipliers[unit] || 0);
    
    // If amount is negative, it means "before" the reference time
    if (amount < 0) {
      return Math.max(0, baseTime + delayMs - Date.now());
    }
    
    return delayMs;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  private async checkActionConditions(action: any, eventData: any): Promise<boolean> {
    if (!action.config?.conditions || action.config.conditions.length === 0) {
      return true;
    }
    
    for (const condition of action.config.conditions) {
      switch (condition.type) {
        case 'business-hours':
          const now = new Date();
          const hour = now.getHours();
          const dayOfWeek = now.getDay();
          
          const isBusinessHours = hour >= 8 && hour < 18 && dayOfWeek >= 1 && dayOfWeek <= 5;
          
          if (!isBusinessHours && condition.rescheduleIfOutside) {
            const nextBusinessDay = this.getNextBusinessHour(now);
            action.config.delay = {
              amount: Math.floor((nextBusinessDay.getTime() - now.getTime()) / (60 * 1000)),
              unit: 'minutes'
            };
          }
          
          return isBusinessHours || condition.rescheduleIfOutside;
          
        case 'stage-still-in':
          if (!condition.stageId || !eventData.projectId) return true;
          
          const project = await this.db.collection('projects').findOne({
            _id: new ObjectId(eventData.projectId)
          });
          
          return project?.stageId === condition.stageId;
          
        default:
          return true;
      }
    }
    
    return true;
  }

  private getNextBusinessHour(from: Date): Date {
    const next = new Date(from);
    next.setHours(8, 0, 0, 0);
    
    if (from.getHours() < 8) {
      return next;
    }
    
    next.setDate(next.getDate() + 1);
    
    while (next.getDay() === 0 || next.getDay() === 6) {
      next.setDate(next.getDate() + 1);
    }
    
    return next;
  }

  // ✅ ADD PAYMENT AND QUOTE HANDLERS
  private async handlePaymentReceived(event: any) {
    // Find automation rules for payment received
    const rules = await this.db.collection('automation_rules').find({
      locationId: event.data.locationId || event.locationId,
      isActive: true,
              'trigger.type': 'payment-received'
    }).toArray();

    if (rules.length === 0) return;

    for (const rule of rules) {
      await this.queueAutomation(rule, {
        type: 'payment-received',
        data: event.data || event,
        timestamp: new Date()
      });
    }
  }

  private async handleQuoteSigned(event: any) {
    // Find automation rules for quote signed
    const rules = await this.db.collection('automation_rules').find({
      locationId: event.data.locationId || event.locationId,
      isActive: true,
              'trigger.type': 'quote-signed'
    }).toArray();

    if (rules.length === 0) return;

    for (const rule of rules) {
      await this.queueAutomation(rule, {
        type: 'quote-signed',
        data: event.data || event,
        timestamp: new Date()
      });
    }
  }

  private async handleQuoteExpired(event: any) {
    // Find automation rules for quote expired
    const rules = await this.db.collection('automation_rules').find({
      locationId: event.data.locationId || event.locationId,
      isActive: true,
      'trigger.type': 'quote-expired'
    }).toArray();

    if (rules.length === 0) return;

    for (const rule of rules) {
      await this.queueAutomation(rule, {
        type: 'quote-expired',
        data: event.data || event,
        timestamp: new Date()
      });
    }
  }

  private async handleQuoteViewed(event: any) {
    // Find automation rules for quote viewed
    const rules = await this.db.collection('automation_rules').find({
      locationId: event.data.locationId || event.locationId,
      isActive: true,
      'trigger.type': 'quote-viewed'
    }).toArray();

    if (rules.length === 0) return;

    for (const rule of rules) {
      await this.queueAutomation(rule, {
        type: 'quote-viewed',
        data: event.data || event,
        timestamp: new Date()
      });
    }
  }

  private async handleAppointmentScheduled(event: any) {
    // Extract appointment ID from event data
    const appointmentId = event.data?.appointmentId || event.appointmentId;
    
    if (!appointmentId) {
      console.log('No appointment ID found in appointment-scheduled event, skipping');
      return;
    }

    // Check for duplicate appointment triggers in the last 5 minutes
    const existingAppointmentTrigger = await this.db.collection('automation_queue').findOne({
      'trigger.data.appointmentId': appointmentId,
      'trigger.type': { $in: ['appointment-scheduled', 'job:scheduled'] },
      createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // Last 5 minutes
    });

    if (existingAppointmentTrigger) {
      console.log(`Duplicate appointment trigger detected for ${appointmentId}, skipping`);
      return;
    }

      // ✅ Find automation rules for appointment scheduled - MATCH BY CALENDAR
      const query: any = {
        locationId: event.data.locationId || event.locationId,
        isActive: true,
        'trigger.type': 'appointment-scheduled'
      };

      // Filter by calendarId - ONLY match exact calendar
      const appointmentCalendarId = event.data?.calendarId || event.calendarId;
      if (appointmentCalendarId) {
        query.calendarId = appointmentCalendarId;
        console.log(`🎯 Filtering automations for ONLY calendar: ${appointmentCalendarId}`);
      }

      const rules = await this.db.collection('automation_rules').find(query).toArray();

      console.log(`Found ${rules.length} appointment-scheduled rules for calendar: ${appointmentCalendarId || 'any'}`);

      if (rules.length === 0) return;

      // ✅ CHECK CONDITIONS BEFORE QUEUING (same pattern as quote triggers)
      for (const rule of rules) {
        let shouldQueue = true;
        
        // Check calendarId condition explicitly
        if (rule.conditions && rule.conditions.length > 0) {
          for (const condition of rule.conditions) {
            if (condition.field === 'calendarId') {
              const matches = condition.value === appointmentCalendarId;
              console.log(`🎯 [Condition Check] ${rule.name}: calendarId ${appointmentCalendarId} === ${condition.value} = ${matches}`);
              
              if (!matches) {
                console.log(`❌ Skipping rule "${rule.name}" - calendar condition not met`);
                shouldQueue = false;
                break;
              }
            }
          }
        }
        
        if (!shouldQueue) continue;
        
        console.log(`✅ Queuing rule "${rule.name}" - conditions met`);
        
        await this.queueAutomation(rule, {
          type: 'appointment-scheduled',
          data: event.data || event,
          timestamp: new Date()
        });
      }
  }

  private async handleAppointmentCompleted(event: any) {
    // Extract appointment ID from event data
    const appointmentId = event.data?.appointmentId || event.appointmentId;
    
    if (!appointmentId) {
      console.log('No appointment ID found in appointment-completed event, skipping');
      return;
    }

    // Check for duplicate appointment triggers in the last 5 minutes
    const existingAppointmentTrigger = await this.db.collection('automation_queue').findOne({
      'trigger.data.appointmentId': appointmentId,
      'trigger.type': 'appointment-completed',
      createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // Last 5 minutes
    });

    if (existingAppointmentTrigger) {
      console.log(`Duplicate appointment completed trigger detected for ${appointmentId}, skipping`);
      return;
    }

    // Find automation rules for appointment completed
    const rules = await this.db.collection('automation_rules').find({
      locationId: event.data.locationId || event.locationId,
      isActive: true,
      'trigger.type': 'appointment-completed'
    }).toArray();

    if (rules.length === 0) return;

    for (const rule of rules) {
      await this.queueAutomation(rule, {
        type: 'appointment-completed',
        data: event.data || event,
        timestamp: new Date()
      });
    }
  }

  private async handleAppointmentNoShow(event: any) {
    // Find automation rules for appointment no-show
    const rules = await this.db.collection('automation_rules').find({
      locationId: event.data.locationId || event.locationId,
      isActive: true,
      'trigger.type': 'appointment-noshow'
    }).toArray();

    if (rules.length === 0) return;

    for (const rule of rules) {
      await this.queueAutomation(rule, {
        type: 'appointment-noshow',
        data: event.data || event,
        timestamp: new Date()
      });
    }
  }

  private async handleAppointmentRescheduled(event: any) {
    // Find automation rules for appointment rescheduled
    const rules = await this.db.collection('automation_rules').find({
      locationId: event.data.locationId || event.locationId,
      isActive: true,
      'trigger.type': 'appointment-rescheduled'
    }).toArray();

    if (rules.length === 0) return;

    for (const rule of rules) {
      await this.queueAutomation(rule, {
        type: 'appointment-rescheduled',
        data: event.data || event,
        timestamp: new Date()
      });
    }
  }

  private async handleSmsReceived(event: any) {
    // Find automation rules for SMS received
    const rules = await this.db.collection('automation_rules').find({
      locationId: event.data.locationId || event.locationId,
      isActive: true,
      'trigger.type': 'sms-received'
    }).toArray();

    if (rules.length === 0) return;

    for (const rule of rules) {
      await this.queueAutomation(rule, {
        type: 'sms-received',
        data: event.data || event,
        timestamp: new Date()
      });
    }
  }

  private async handleEmailOpened(event: any) {
    // Find automation rules for email opened
    const rules = await this.db.collection('automation_rules').find({
      locationId: event.data.locationId || event.locationId,
      isActive: true,
      'trigger.type': 'email-opened'
    }).toArray();

    if (rules.length === 0) return;

    for (const rule of rules) {
      await this.queueAutomation(rule, {
        type: 'email-opened',
        data: event.data || event,
        timestamp: new Date()
      });
    }
  }

  private async handleFormSubmitted(event: any) {
    // Find automation rules for form submitted
    const rules = await this.db.collection('automation_rules').find({
      locationId: event.data.locationId || event.locationId,
      isActive: true,
      'trigger.type': 'form-submitted'
    }).toArray();

    if (rules.length === 0) return;

    for (const rule of rules) {
      await this.queueAutomation(rule, {
        type: 'form-submitted',
        data: event.data || event,
        timestamp: new Date()
      });
    }
  }

  private async handleReviewReceived(event: any) {
    // Find automation rules for review received
    const rules = await this.db.collection('automation_rules').find({
      locationId: event.data.locationId || event.locationId,
      isActive: true,
      'trigger.type': 'review-received'
    }).toArray();

    if (rules.length === 0) return;

    for (const rule of rules) {
      await this.queueAutomation(rule, {
        type: 'review-received',
        data: event.data || event,
        timestamp: new Date()
      });
    }
  }

  // Add quote expired event emission
  async emitQuoteExpired(quote: any) {
    try {
      // Find automation rules for quote expired
      const rules = await this.db.collection('automation_rules').find({
        locationId: quote.locationId,
        isActive: true,
        'trigger.type': 'quote-expired'
      }).toArray();

      if (rules.length === 0) return;

      const project = await this.db.collection('projects').findOne({ _id: new ObjectId(quote.projectId) });
      const contact = await this.db.collection('contacts').findOne({ _id: new ObjectId(quote.contactId) });

      for (const rule of rules) {
        await this.queueAutomation(rule, {
          type: 'quote-expired',
          data: {
            quoteId: quote._id.toString(),
            projectId: quote.projectId,
            contactId: quote.contactId,
            amount: quote.total,
            quoteTotal: quote.total,
            quoteCurrency: quote.currency || 'USD',
            quoteNumber: quote.quoteNumber,
            pipelineId: quote.pipelineId || project?.pipelineId,
            pipelineStageId: quote.pipelineStageId || project?.pipelineStageId,
            quoteDepositAmount: quote.depositAmount || 0,
            quoteExpirationDate: quote.expirationDate,
            quoteStatus: quote.status,
            quote,
            project,
            contact,
            locationId: quote.locationId
          },
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error emitting quote-expired:', error);
    }
  }

  async emitQuoteViewed(quote: any) {
    try {
      // Find automation rules for quote viewed
      const rules = await this.db.collection('automation_rules').find({
        locationId: quote.locationId,
        isActive: true,
        'trigger.type': 'quote-viewed'
      }).toArray();

      if (rules.length === 0) return;

      const project = await this.db.collection('projects').findOne({ _id: new ObjectId(quote.projectId) });
      const contact = await this.db.collection('contacts').findOne({ _id: new ObjectId(quote.contactId) });

      for (const rule of rules) {
        // CHECK CONDITIONS BEFORE QUEUING (same pattern as quote-signed)
        if (rule.conditions && rule.conditions.length > 0) {
          let shouldQueue = true;
          
          for (const condition of rule.conditions) {
            if (condition.field === 'pipelineStageId') {
              const value = project?.pipelineStageId || quote.pipelineStageId;
              shouldQueue = value === condition.value;
              
              console.log(`🎯 [Condition Check] ${rule.name}: pipelineStageId ${value} === ${condition.value} = ${shouldQueue}`);
              
              if (!shouldQueue) {
                console.log(`❌ Skipping rule "${rule.name}" - pipeline stage condition not met`);
                break;
              }
            }
            // Add other condition checks as needed
          }
          
          if (!shouldQueue) {
            continue; // Skip this rule entirely
          }
        }

        console.log(`✅ Queuing rule "${rule.name}" - conditions met or no conditions`);
        
        await this.queueAutomation(rule, {
          type: 'quote-viewed',
          data: {
            quoteId: quote._id.toString(),
            projectId: quote.projectId,
            contactId: quote.contactId,
            amount: quote.total,
            quoteTotal: quote.total,
            quoteCurrency: quote.currency || 'USD',
            quoteNumber: quote.quoteNumber,
            pipelineId: quote.pipelineId || project?.pipelineId,
            pipelineStageId: quote.pipelineStageId || project?.pipelineStageId,
            quoteDepositAmount: quote.depositAmount || 0,
            quoteExpirationDate: quote.expirationDate,
            quoteStatus: quote.status,
            quote,
            project,
            contact,
            locationId: quote.locationId
          },
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error emitting quote-viewed:', error);
    }
  }

  async emitQuoteSigned(quote: any) {
    try {
      // Find automation rules for quote signed
      const rules = await this.db.collection('automation_rules').find({
        locationId: quote.locationId,
        isActive: true,
        'trigger.type': 'quote-signed'
      }).toArray();

      if (rules.length === 0) return;

      const project = quote.projectId ? 
        await this.db.collection('projects').findOne({ _id: new ObjectId(quote.projectId) }) : null;
      const contact = quote.contactId ? 
        await this.db.collection('contacts').findOne({ _id: new ObjectId(quote.contactId) }) : null;

      console.log(`🔍 [Quote Signed] Debug info:`, {
        quoteId: quote._id.toString(),
        quoteNumber: quote.quoteNumber,
        depositAmount: quote.depositAmount,
        depositRequired: Boolean(quote.depositAmount && quote.depositAmount > 0),
        rulesFound: rules.length
      });

      // FIXED: Pass deposit amount directly at the root level for easy condition checking
      const depositAmount = quote.depositAmount || 0;
      const depositRequired = depositAmount > 0;

      console.log('🎯 [emitQuoteSigned] Deposit data being sent to automation:', {
        quoteId: quote._id.toString(),
        quoteNumber: quote.quoteNumber,
        depositAmount,
        depositRequired
      });

      for (const rule of rules) {
        console.log(`📋 [Rule Check] ${rule.name}:`, {
          ruleId: rule._id,
          conditions: rule.conditions,
          conditionFieldPath: rule.conditions?.[0]?.field,
          conditionValue: rule.conditions?.[0]?.value
        });

        // CHECK CONDITIONS BEFORE QUEUING
        if (rule.conditions && rule.conditions.length > 0) {
          let shouldQueue = true;
          
          for (const condition of rule.conditions) {
            if (condition.field === 'depositAmount') {
              const value = depositAmount;
              
              switch (condition.operator) {
                case 'equals':
                  shouldQueue = value == condition.value;
                  break;
                case 'greater-than':
                  shouldQueue = Number(value) > Number(condition.value);
                  break;
                case 'less-than':
                  shouldQueue = Number(value) < Number(condition.value);
                  break;
                default:
                  console.log(`⚠️ Unknown operator: ${condition.operator}`);
              }
              
              console.log(`🎯 [Condition Check] ${rule.name}: ${value} ${condition.operator} ${condition.value} = ${shouldQueue}`);
              
              if (!shouldQueue) {
                console.log(`❌ Skipping rule "${rule.name}" - condition not met`);
                break;
              }
            }
          }
          
          if (!shouldQueue) {
            continue; // Skip this rule entirely
          }
        }

        console.log(`✅ Queuing rule "${rule.name}" - conditions met or no conditions`);

        await this.queueAutomation(rule, {
          type: 'quote-signed',
          // Put deposit amount at TOP LEVEL for easy access
          depositAmount: depositAmount,
          depositRequired: depositRequired,
          data: {
            quoteId: quote._id.toString(),
            projectId: quote.projectId,
            contactId: quote.contactId,
            amount: quote.total,
            quoteTotal: quote.total,
            quoteCurrency: quote.currency || 'USD',
            quoteNumber: quote.quoteNumber,
            pipelineId: quote.pipelineId || project?.pipelineId,
            pipelineStageId: quote.pipelineStageId || project?.pipelineStageId,
            // ALSO keep it in data for backward compatibility
            quoteDepositAmount: depositAmount,
            quoteDepositRequired: depositRequired,
            quoteExpirationDate: quote.expirationDate,
            quoteStatus: quote.status,
            signedAt: new Date(),
            signedDate: new Date(quote.signedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
            quote: {
              ...quote,
              depositRequired: depositRequired
            },
            project,
            contact,
            locationId: quote.locationId
          },
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error emitting quote-signed:', error);
    }
  }

  async emitQuotePresented(quote: any) {
    try {
      // Find automation rules for quote presented
      const rules = await this.db.collection('automation_rules').find({
        locationId: quote.locationId,
        isActive: true,
        'trigger.type': 'quote-presented'
      }).toArray();

      if (rules.length === 0) return;

      const project = quote.projectId ? 
        await this.db.collection('projects').findOne({ _id: new ObjectId(quote.projectId) }) : null;
      const contact = quote.contactId ? 
        await this.db.collection('contacts').findOne({ _id: new ObjectId(quote.contactId) }) : null;

      for (const rule of rules) {
        await this.queueAutomation(rule, {
          type: 'quote-presented',
          data: {
            quoteId: quote._id.toString(),
            projectId: quote.projectId,
            contactId: quote.contactId,
            amount: quote.total,
            quoteTotal: quote.total,
            quoteCurrency: quote.currency || 'USD',
            quoteNumber: quote.quoteNumber,
            pipelineId: quote.pipelineId || project?.pipelineId,
            pipelineStageId: quote.pipelineStageId || project?.pipelineStageId,
            quoteDepositAmount: quote.depositAmount || 0,
            quoteExpirationDate: quote.expirationDate,
            quoteStatus: quote.status,
            presentedAt: new Date(),
            presentedInPerson: true,
            quote,
            project,
            contact,
            locationId: quote.locationId
          },
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error emitting quote-presented:', error);
    }
  }

  async emitQuoteSent(quote: any) {
    try {
      // Find automation rules for quote sent
      const rules = await this.db.collection('automation_rules').find({
        locationId: quote.locationId,
        isActive: true,
        'trigger.type': 'quote-sent'
      }).toArray();

      if (rules.length === 0) return;

      const project = quote.projectId ? 
        await this.db.collection('projects').findOne({ _id: new ObjectId(quote.projectId) }) : null;
      const contact = quote.contactId ? 
        await this.db.collection('contacts').findOne({ _id: new ObjectId(quote.contactId) }) : null;

      for (const rule of rules) {
        await this.queueAutomation(rule, {
          type: 'quote-sent',
          data: {
            quoteId: quote._id.toString(),
            projectId: quote.projectId,
            contactId: quote.contactId,
            amount: quote.total,
            quoteTotal: quote.total,
            quoteCurrency: quote.currency || 'USD',
            quoteNumber: quote.quoteNumber,
            pipelineId: quote.pipelineId || project?.pipelineId,
            pipelineStageId: quote.pipelineStageId || project?.pipelineStageId,
            quoteDepositAmount: quote.depositAmount || 0,
            quoteExpirationDate: quote.expirationDate,
            quoteStatus: quote.status,
            sentAt: new Date(),
            quote,
            project,
            contact,
            locationId: quote.locationId
          },
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error emitting quote-sent:', error);
    }
  }

  async emitQuotePublished(quote: any) {
    try {
      // Find automation rules for quote published
      const rules = await this.db.collection('automation_rules').find({
        locationId: quote.locationId,
        isActive: true,
        'trigger.type': 'quote-published'
      }).toArray();

      if (rules.length === 0) return;

      const project = quote.projectId ? 
        await this.db.collection('projects').findOne({ _id: new ObjectId(quote.projectId) }) : null;
      const contact = quote.contactId ? 
        await this.db.collection('contacts').findOne({ _id: new ObjectId(quote.contactId) }) : null;

      for (const rule of rules) {
        await this.queueAutomation(rule, {
          type: 'quote-published',
          data: {
            quoteId: quote._id.toString(),
            projectId: quote.projectId,
            contactId: quote.contactId,
            amount: quote.total,
            quoteTotal: quote.total,
            quoteCurrency: quote.currency || 'USD',
            quoteNumber: quote.quoteNumber,
            pipelineId: quote.pipelineId || project?.pipelineId,
            pipelineStageId: quote.pipelineStageId || project?.pipelineStageId,
            quoteDepositAmount: quote.depositAmount || 0,
            quoteExpirationDate: quote.expirationDate,
            quoteStatus: quote.status,
            publishedAt: new Date(),
            webLinkToken: quote.webLinkToken,
            quote,
            project,
            contact,
            locationId: quote.locationId
          },
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error emitting quote-published:', error);
    }
  }

  async emitAppointmentScheduled(appointment: any) {
    try {
      const appointmentId = appointment._id?.toString() || appointment.appointmentId;
      
      if (!appointmentId) {
        console.log('No appointment ID found in emitAppointmentScheduled, skipping');
        return;
      }

      // Check for duplicate
      const existingTrigger = await this.db.collection('automation_queue').findOne({
        'trigger.data.appointmentId': appointmentId,
        'trigger.type': { $in: ['appointment-scheduled', 'job:scheduled'] },
        createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) }
      });

      if (existingTrigger) {
        console.log(`Duplicate appointment trigger detected for ${appointmentId}, skipping`);
        return;
      }

      // 1. Handle immediate appointment-scheduled automations - MATCH BY CALENDAR
      const immediateQuery: any = {
        locationId: appointment.locationId,
        isActive: true,
        'trigger.type': 'appointment-scheduled'
      };

      // Filter by calendarId - ONLY match exact calendar
      if (appointment.calendarId) {
        immediateQuery.calendarId = appointment.calendarId;
        console.log(`🎯 [emitAppointmentScheduled] Filtering for ONLY calendar: ${appointment.calendarId}`);
      }

      const immediateRules = await this.db.collection('automation_rules').find(immediateQuery).toArray();

      const project = appointment.projectId ? 
        await this.db.collection('projects').findOne({ _id: new ObjectId(appointment.projectId) }) : null;
      const contact = appointment.contactId ?
        await this.db.collection('contacts').findOne({ _id: new ObjectId(appointment.contactId) }) : null;

      for (const rule of immediateRules) {
        await this.queueAutomation(rule, {
          type: 'appointment-scheduled',
          data: {
            appointmentId: appointmentId,
            projectId: appointment.projectId,
            contactId: appointment.contactId,
            calendarId: appointment.calendarId,
            appointment,
            project,
            contact,
            locationId: appointment.locationId
          },
          timestamp: new Date()
        });
      }

      // ✅ 2. Handle time-based appointment automations - MATCH BY CALENDAR
      const timeBasedQuery: any = {
        locationId: appointment.locationId,
        isActive: true,
        'trigger.type': 'time-based',
        'trigger.entityType': 'appointment'
      };

      // Filter by calendarId - ONLY match exact calendar
      if (appointment.calendarId) {
        timeBasedQuery.calendarId = appointment.calendarId;
        console.log(`🎯 Filtering time-based automations for ONLY calendar: ${appointment.calendarId}`);
      }

      const timeBasedRules = await this.db.collection('automation_rules').find(timeBasedQuery).toArray();

      console.log(`Found ${timeBasedRules.length} time-based rules for calendar: ${appointment.calendarId || 'any'}`);

      console.log(`Found ${timeBasedRules.length} time-based appointment rules`);

      if (timeBasedRules.length > 0) {
        const appointmentStart = new Date(appointment.start || appointment.startTime || appointment.scheduledTime);
        
        for (const rule of timeBasedRules) {
          // ✅ ADD THIS: Check calendarId condition before queuing
          let shouldQueue = true;
          
          if (rule.conditions && rule.conditions.length > 0) {
            for (const condition of rule.conditions) {
              if (condition.field === 'calendarId') {
                const matches = condition.value === appointment.calendarId;
                console.log(`🎯 [Time-Based Check] ${rule.name}: calendarId ${appointment.calendarId} === ${condition.value} = ${matches}`);
                
                if (!matches) {
                  console.log(`❌ Skipping rule "${rule.name}" - calendar condition not met`);
                  shouldQueue = false;
                  break;
                }
              }
            }
          }
          
          if (!shouldQueue) continue;
          
          // Support both old and new trigger formats
          let totalDelayMs = 0;
          
          if (rule.trigger.config?.delayHours !== undefined || rule.trigger.config?.delayMinutes !== undefined) {
            // Old format: config.delayHours, config.delayMinutes
            const delayHours = rule.trigger.config?.delayHours || 0;
            const delayMinutes = rule.trigger.config?.delayMinutes || 0;
            totalDelayMs = (delayHours * 60 * 60 * 1000) + (delayMinutes * 60 * 1000);
          } else if (rule.trigger.amount && rule.trigger.unit) {
            // New format: timing: "before"/"after", amount: 1, unit: "hours"/"minutes"/"days"
            const multipliers = {
              'minutes': 60 * 1000,
              'hours': 60 * 60 * 1000,
              'days': 24 * 60 * 60 * 1000
            };
            
            const multiplier = multipliers[rule.trigger.unit as keyof typeof multipliers] || multipliers['hours'];
            totalDelayMs = rule.trigger.amount * multiplier;
            
            // If timing is "before", make it negative
            if (rule.trigger.timing === 'before') {
              totalDelayMs = -totalDelayMs;
            }
          }
          
          const triggerTime = new Date(appointmentStart.getTime() + totalDelayMs);

          // Only schedule if trigger time is in the future
          if (triggerTime > new Date()) {
            const delayDescription = totalDelayMs < 0 ? 
              `${Math.abs(totalDelayMs / 60000)} minutes before` : 
              `${totalDelayMs / 60000} minutes after`;
            
            console.log(`Scheduling ${rule.name} for ${triggerTime.toISOString()} (${delayDescription} appointment start)`);

            // Queue each action individually
            for (const action of rule.actions) {
              await this.db.collection('automation_queue').insertOne({
                ruleId: rule._id,
                action,
                actionType: action.type,
                trigger: {
                  type: 'time-based-trigger',
                  locationId: appointment.locationId,
                  data: {
                    appointmentId,
                    projectId: appointment.projectId,
                    contactId: appointment.contactId,
                    calendarId: appointment.calendarId,
                    appointment,
                    project,
                    contact,
                    locationId: appointment.locationId
                  }
                },
                status: 'scheduled',
                scheduledFor: triggerTime,
                createdAt: new Date(),
                attempts: 0,
                metadata: {
                  appointmentId,
                  triggerType: totalDelayMs < 0 ? 'reminder' : 'follow-up',
                  delayMinutes: totalDelayMs / 60000,
                  originalRuleId: rule._id.toString()
                }
              });
            }
          } else {
            console.log(`Skipping ${rule.name} - trigger time ${triggerTime.toISOString()} is in the past`);
          }
        }
      }

    } catch (error) {
      console.error('Error emitting appointment-scheduled:', error);
    }
  }

  // Add cleanup method for cancelled/rescheduled appointments
  async emitAppointmentCancelled(appointment: any) {
    try {
      const appointmentId = appointment._id?.toString() || appointment.appointmentId;
      
      if (!appointmentId) {
        console.log('No appointment ID found in emitAppointmentCancelled, skipping');
        return;
      }

      console.log(`Cleaning up scheduled automations for cancelled appointment: ${appointmentId}`);

      // Remove any scheduled reminder automations for this appointment
      const deleteResult = await this.db.collection('automation_queue').deleteMany({
        'metadata.appointmentId': appointmentId,
        status: 'scheduled'
      });

      console.log(`Cleaned up ${deleteResult.deletedCount} scheduled automations for appointment ${appointmentId}`);

      // ✅ Handle appointment-cancelled automations - MATCH BY CALENDAR
      const cancelQuery: any = {
        locationId: appointment.locationId,
        isActive: true,
        'trigger.type': 'appointment-cancelled'
      };

      if (appointment.calendarId) {
        cancelQuery.$or = [
          { calendarId: appointment.calendarId },
          { calendarId: { $exists: false } },
          { calendarId: null }
        ];
      }

      const cancelRules = await this.db.collection('automation_rules').find(cancelQuery).toArray();

      console.log(`Found ${cancelRules.length} appointment-cancelled rules for calendar: ${appointment.calendarId || 'any'}`);

      for (const rule of cancelRules) {
        await this.queueAutomation(rule, {
          type: 'appointment-cancelled',
          data: {
            appointmentId: appointment._id.toString(),
            appointmentTitle: appointment.title,
            locationId: appointment.locationId
          },
          timestamp: new Date()
        });
      }

    } catch (error) {
      console.error('Error handling appointment cancellation:', error);
    }
  }

  async emitAppointmentRescheduled(oldAppointment: any, newAppointment: any) {
    try {
      const appointmentId = oldAppointment._id?.toString() || oldAppointment.appointmentId;
      
      if (!appointmentId) {
        console.log('No appointment ID found in emitAppointmentRescheduled, skipping');
        return;
      }

      console.log(`Handling rescheduled appointment: ${appointmentId}`);

      // 1. Clean up old scheduled reminders
      const deleteResult = await this.db.collection('automation_queue').deleteMany({
        'metadata.appointmentId': appointmentId,
        status: 'scheduled'
      });

      console.log(`Cleaned up ${deleteResult.deletedCount} old scheduled automations`);

      // 2. Create new scheduled reminders with new appointment time
      await this.emitAppointmentScheduled(newAppointment);

      // ✅ 3. Handle appointment-rescheduled automations - MATCH BY CALENDAR
      const rescheduleQuery: any = {
        locationId: newAppointment.locationId,
        isActive: true,
        'trigger.type': 'appointment-rescheduled'
      };

      if (newAppointment.calendarId) {
        rescheduleQuery.calendarId = newAppointment.calendarId;
        console.log(`🎯 Filtering reschedule automations for ONLY calendar: ${newAppointment.calendarId}`);
      }

      const rescheduleRules = await this.db.collection('automation_rules').find(rescheduleQuery).toArray();

      console.log(`Found ${rescheduleRules.length} appointment-rescheduled rules for calendar: ${newAppointment.calendarId || 'any'}`);

      for (const rule of rescheduleRules) {
        await this.queueAutomation(rule, {
          type: 'appointment-rescheduled',
          data: {
            appointmentId: appointmentId,
            oldTime: oldAppointment.start || oldAppointment.startTime,
            newTime: newAppointment.start || newAppointment.startTime,
            locationId: newAppointment.locationId
          },
          timestamp: new Date()
        });
      }

    } catch (error) {
      console.error('Error handling appointment reschedule:', error);
    }
  }

  async emitAppointmentCompleted(appointment: any) {
    try {
      // Extract appointment ID
      const appointmentId = appointment._id?.toString() || appointment.appointmentId;
      
      if (!appointmentId) {
        console.log('No appointment ID found in emitAppointmentCompleted, skipping');
        return;
      }

      // Check for duplicate appointment triggers in the last 5 minutes
      const existingAppointmentTrigger = await this.db.collection('automation_queue').findOne({
        'trigger.data.appointmentId': appointmentId,
        'trigger.type': 'appointment-completed',
        createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // Last 5 minutes
      });

      if (existingAppointmentTrigger) {
        console.log(`Duplicate appointment completed trigger detected for ${appointmentId}, skipping`);
        return;
      }

      // ✅ Find automation rules for appointment completed - MATCH BY CALENDAR
      const completedQuery: any = {
        locationId: appointment.locationId,
        isActive: true,
        'trigger.type': 'appointment-completed'
      };

      if (appointment.calendarId) {
        completedQuery.calendarId = appointment.calendarId;
        console.log(`🎯 Filtering completed automations for ONLY calendar: ${appointment.calendarId}`);
      }

      const rules = await this.db.collection('automation_rules').find(completedQuery).toArray();

      console.log(`Found ${rules.length} appointment-completed rules for calendar: ${appointment.calendarId || 'any'}`);

      if (rules.length === 0) return;

      const project = appointment.projectId ? 
        await this.db.collection('projects').findOne({ _id: new ObjectId(appointment.projectId) }) : null;
      const contact = appointment.contactId ? 
        await this.db.collection('contacts').findOne({ _id: new ObjectId(appointment.contactId) }) : null;

      for (const rule of rules) {
        await this.queueAutomation(rule, {
          type: 'appointment-completed',
          data: {
            appointmentId: appointment._id.toString(),
            projectId: appointment.projectId,
            contactId: appointment.contactId,
            completedAt: new Date(),
            appointment,
            project,
            contact,
            locationId: appointment.locationId
          },
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error emitting appointment-completed:', error);
    }
  }

  async emitAppointmentNoShow(appointment: any) {
    try {
      // Find automation rules for appointment no-show
      const rules = await this.db.collection('automation_rules').find({
        locationId: appointment.locationId,
        isActive: true,
        'trigger.type': 'appointment-noshow'
      }).toArray();

      if (rules.length === 0) return;

      const project = appointment.projectId ? 
        await this.db.collection('projects').findOne({ _id: new ObjectId(appointment.projectId) }) : null;
      const contact = appointment.contactId ? 
        await this.db.collection('contacts').findOne({ _id: new ObjectId(appointment.contactId) }) : null;

      for (const rule of rules) {
        await this.queueAutomation(rule, {
          type: 'appointment-noshow',
          data: {
            appointmentId: appointment._id.toString(),
            projectId: appointment.projectId,
            contactId: appointment.contactId,
            noShowAt: new Date(),
            appointment,
            project,
            contact,
            locationId: appointment.locationId
          },
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error emitting appointment-noshow:', error);
    }
  }

  async emitAppointmentCancelled(appointment: any) {
    try {
      // Find automation rules for appointment cancelled
      const rules = await this.db.collection('automation_rules').find({
        locationId: appointment.locationId,
        isActive: true,
        'trigger.type': 'appointment-cancelled'
      }).toArray();

      if (rules.length === 0) return;

      const project = appointment.projectId ? 
        await this.db.collection('projects').findOne({ _id: new ObjectId(appointment.projectId) }) : null;
      const contact = appointment.contactId ? 
        await this.db.collection('contacts').findOne({ _id: new ObjectId(appointment.contactId) }) : null;

      for (const rule of rules) {
        await this.queueAutomation(rule, {
          type: 'appointment-cancelled',
          data: {
            appointmentId: appointment._id.toString(),
            projectId: appointment.projectId,
            contactId: appointment.contactId,
            cancelledAt: new Date(),
            appointment,
            project,
            contact,
            locationId: appointment.locationId
          },
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error emitting appointment-cancelled:', error);
    }
  }

  async emitAppointmentRescheduled(oldAppointment: any, newAppointment: any) {
    try {
      // Find automation rules for appointment rescheduled
      const rules = await this.db.collection('automation_rules').find({
        locationId: newAppointment.locationId,
        isActive: true,
        'trigger.type': 'appointment-rescheduled'
      }).toArray();

      if (rules.length === 0) return;

      const project = newAppointment.projectId ? 
        await this.db.collection('projects').findOne({ _id: new ObjectId(newAppointment.projectId) }) : null;
      const contact = newAppointment.contactId ? 
        await this.db.collection('contacts').findOne({ _id: new ObjectId(newAppointment.contactId) }) : null;

      for (const rule of rules) {
        await this.queueAutomation(rule, {
          type: 'appointment-rescheduled',
          data: {
            appointmentId: newAppointment._id.toString(),
            projectId: newAppointment.projectId,
            contactId: newAppointment.contactId,
            oldTime: oldAppointment.scheduledTime,
            newTime: newAppointment.scheduledTime,
            appointment: newAppointment,
            project,
            contact,
            locationId: newAppointment.locationId
          },
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error emitting appointment-rescheduled:', error);
    }
  }

  async emitSmsReceived(data: any) {
    try {
      // Find automation rules for SMS received
      const rules = await this.db.collection('automation_rules').find({
        locationId: data.locationId,
        isActive: true,
        'trigger.type': 'sms-received'
      }).toArray();

      if (rules.length === 0) return;

      for (const rule of rules) {
        await this.queueAutomation(rule, {
          type: 'sms-received',
          data: {
            ...data,
            locationId: data.locationId
          },
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error emitting sms-received:', error);
    }
  }

  async emitEmailOpened(data: any) {
    try {
      // Find automation rules for email opened
      const rules = await this.db.collection('automation_rules').find({
        locationId: data.locationId,
        isActive: true,
        'trigger.type': 'email-opened'
      }).toArray();

      if (rules.length === 0) return;

      for (const rule of rules) {
        await this.queueAutomation(rule, {
          type: 'email-opened',
          data: {
            ...data,
            locationId: data.locationId
          },
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error emitting email-opened:', error);
    }
  }

  async emitFormSubmitted(data: any) {
    try {
      // Find automation rules for form submitted
      const rules = await this.db.collection('automation_rules').find({
        locationId: data.locationId,
        isActive: true,
        'trigger.type': 'form-submitted'
      }).toArray();

      if (rules.length === 0) return;

      for (const rule of rules) {
        await this.queueAutomation(rule, {
          type: 'form-submitted',
          data: {
            ...data,
            locationId: data.locationId
          },
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error emitting form-submitted:', error);
    }
  }

  async emitReviewReceived(data: any) {
    try {
      // Find automation rules for review received
      const rules = await this.db.collection('automation_rules').find({
        locationId: data.locationId,
        isActive: true,
        'trigger.type': 'review-received'
      }).toArray();

      if (rules.length === 0) return;

      for (const rule of rules) {
        await this.queueAutomation(rule, {
          type: 'review-received',
          data: {
            ...data,
            locationId: data.locationId
          },
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('Error emitting review-received:', error);
    }
  }
}