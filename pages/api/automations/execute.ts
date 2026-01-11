// File: pages/api/automations/execute.ts
// Created: December 2024
// Description: API endpoint for executing automation rules

import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '@/lib/mongodb';
import { ObjectId, Db } from 'mongodb';
import axios from 'axios';
import { eventBus } from '../../../src/services/eventBus';
import { getAuthHeader } from '../../../src/utils/ghlAuth';
import { 
  formatTimeWithTimezone, 
  formatDateWithTimezone,
  getTimezoneWithPriority 
} from '../../../src/utils/timezoneUtils';
const OneSignalService = require('../../../src/services/oneSignalService');
import { sendPushNotification } from '@/utils/sendPushNotification';
import { getDbName } from '../../../src/lib/mongodb';

// Helper function
const toObjectId = (id: string | ObjectId) => {
  return typeof id === 'string' ? new ObjectId(id) : id;
};

// Action handler map using existing functions
const ACTION_HANDLERS = {
  // Communication Actions
  'send-sms': executeSMS,
  'send-email': executeEmail,
  'push-notification': executePushNotification,
  'internal-notification': executeInternalNotification,
  'team-notification': executeInternalNotification, // Map team-notification to internal-notification
  'send-daily-brief': executeSendDailyBrief,
  
  // Pipeline Actions
  'move-to-stage': executeMoveToStage,
  'transition-pipeline': executeTransitionPipeline,
  
  // Assignment Actions
  'assign-user': executeAssignUser,
  'round-robin-assign': executeRoundRobinAssign,
  'unassign': executeUnassign,
  
  // Task Actions
  'create-task': executeCreateTask,
  'schedule-task': executeScheduleTask,
  'complete-task': executeCompleteTask,
  
  // Tag Actions
  'add-tag': executeAddTag,
  'remove-tag': executeRemoveTag,
  
  // Field Actions
  'update-field': executeUpdateField,
  'update-custom-field': executeUpdateCustomField,
  'increment-field': executeIncrementField,
  
  // Document Actions
  'generate-quote': executeGenerateQuote,
  'generate-invoice': executeGenerateInvoice,
  'generate-contract': executeGenerateContract,
  
  // Control Flow Actions
  'wait': executeWait,
  'conditional': executeConditional,
  'conditional-action': executeConditional, // Map conditional-action to conditional
  'keyword-router': executeKeywordRouter,
  
  // Location Actions
  'enable-tracking': executeEnableTracking,
  'check-weather': executeCheckWeather,
  
  // Utility Actions
  'add-note': executeAddNote,
  'log-activity': executeLogActivity,
  
  // Advanced Actions
  'create-follow-up': executeCreateFollowUp,
  'duplicate-check': executeDuplicateCheck,
  
  // Integration Actions
  'webhook': executeWebhook
};

// Main execute function - replace your switch statement
async function executeAction(action: any, event: any, location: any, user: any, db: Db, rule: any) {
  const handler = ACTION_HANDLERS[action.type as keyof typeof ACTION_HANDLERS];
  
  if (!handler) {
    console.error(`Unknown action type: ${action.type}`);
    throw new Error(`Unknown action type: ${action.type}`);
  }
  
  // Fix: Properly fetch the project from the database or use the one from event data
  let project = null;
  if (event.projectId) {
    project = await db.collection('projects').findOne({ _id: toObjectId(event.projectId) });
  } else if (event.project?._id) {
    project = event.project;
  } else if (event.data?.project?._id) {
    project = event.data.project;
  }
  
  // Enhanced contact fetching with fallbacks
  let contact = null;
  if (event.contactId) {
    if (/^[a-fA-F0-9]{24}$/.test(event.contactId)) {
      contact = await db.collection('contacts').findOne({ _id: toObjectId(event.contactId) });
    } else {
      contact = await db.collection('contacts').findOne({ ghlContactId: event.contactId });
    }
  } else if (event.contact) {
    contact = event.contact;
  } else if (event.data?.contactId) {
    // Try to get contact from event data
    if (/^[a-fA-F0-9]{24}$/.test(event.data.contactId)) {
      contact = await db.collection('contacts').findOne({ _id: toObjectId(event.data.contactId) });
    } else {
      contact = await db.collection('contacts').findOne({ ghlContactId: event.data.contactId });
    }
  }
  
  // If we still don't have contact but have project, try to get contact from project
  if (!contact && project?.contactId) {
    if (/^[a-fA-F0-9]{24}$/.test(project.contactId)) {
      contact = await db.collection('contacts').findOne({ _id: toObjectId(project.contactId) });
    } else {
      contact = await db.collection('contacts').findOne({ ghlContactId: project.contactId });
    }
  }

  // Enhanced quote fetching for quote-signed events
  let quote = null;
  if (event.quoteId) {
    quote = await db.collection('quotes').findOne({ _id: toObjectId(event.quoteId) });
  } else if (event.data?.quoteId) {
    quote = await db.collection('quotes').findOne({ _id: toObjectId(event.data.quoteId) });
  } else if (project?.activeQuoteId) {
    quote = await db.collection('quotes').findOne({ _id: toObjectId(project.activeQuoteId) });
  } else if (project?.quoteId) {
    quote = await db.collection('quotes').findOne({ _id: toObjectId(project.quoteId) });
  }

  // Format quote data for template variables - properly structure all quote fields
  if (quote) {
    quote.depositRequired = quote.depositAmount > 0;
    quote.number = quote.quoteNumber; // Map quoteNumber to number for {{quote.number}}
    quote.total = `$${quote.total?.toLocaleString() || '0'}`; // Format as currency string
    quote.depositAmount = quote.depositAmount ? `$${quote.depositAmount.toLocaleString()}` : '$0';
    quote.title = quote.title || quote.projectTitle || 'Your Project';
  }

  // Create properly structured context with contract and quote data
  const context = {
    event,
    location,
    user,
    rule,
    contact,
    project: project,  // Use the properly fetched project
    appointment: event.appointmentId ? await db.collection('appointments').findOne({ _id: toObjectId(event.appointmentId) }) : event.appointment,
    quote: quote,
    // Add contract object for {{contract.signedDate}}
    contract: {
      signedDate: event.data?.signedAt || event.data?.signedDate || 
                 (quote?.signedAt ? new Date(quote.signedAt).toLocaleDateString('en-US', { 
                   month: 'long', day: 'numeric', year: 'numeric' 
                 }) : new Date().toLocaleDateString('en-US', { 
                   month: 'long', day: 'numeric', year: 'numeric' 
                 }))
    }
  };
  
  console.log(`Executing ${action.type} with project:`, project?._id);
  
  return await handler(action, context, db);
}

// Execute a single action without full rule context
async function executeSingleAction(db: Db, action: any, trigger: any) {
  const handler = ACTION_HANDLERS[action.type as keyof typeof ACTION_HANDLERS];
  
  if (!handler) {
    console.error(`Unknown action type: ${action.type}`);
    throw new Error(`Unknown action type: ${action.type}`);
  }
  
  // Enhanced context building for single actions
  let contact = null;
  let project = null;
  let location = null;
  let user = null;
  
  // Fetch contact data
  if (trigger?.data?.contactId) {
    if (/^[a-fA-F0-9]{24}$/.test(trigger.data.contactId)) {
      contact = await db.collection('contacts').findOne({ _id: toObjectId(trigger.data.contactId) });
    } else {
      contact = await db.collection('contacts').findOne({ ghlContactId: trigger.data.contactId });
    }
  } else if (trigger?.contactId) {
    if (/^[a-fA-F0-9]{24}$/.test(trigger.contactId)) {
      contact = await db.collection('contacts').findOne({ _id: toObjectId(trigger.contactId) });
    } else {
      contact = await db.collection('contacts').findOne({ ghlContactId: trigger.contactId });
    }
  }
  
  // Fetch project data
  if (trigger?.data?.projectId) {
    project = await db.collection('projects').findOne({ _id: toObjectId(trigger.data.projectId) });
  } else if (trigger?.projectId) {
    project = await db.collection('projects').findOne({ _id: toObjectId(trigger.projectId) });
  }
  
  // Fetch location data
  if (trigger?.data?.locationId) {
    location = await db.collection('locations').findOne({ locationId: trigger.data.locationId });
  } else if (trigger?.locationId) {
    location = await db.collection('locations').findOne({ locationId: trigger.locationId });
  }
  
  // Fetch user data
  if (trigger?.data?.userId) {
    if (/^[a-fA-F0-9]{24}$/.test(trigger.data.userId)) {
      user = await db.collection('users').findOne({ _id: toObjectId(trigger.data.userId) });
    } else {
      user = await db.collection('users').findOne({ ghlUserId: trigger.data.userId });
    }
  } else if (trigger?.userId) {
    if (/^[a-fA-F0-9]{24}$/.test(trigger.userId)) {
      user = await db.collection('users').findOne({ _id: toObjectId(trigger.userId) });
    } else {
      user = await db.collection('users').findOne({ ghlUserId: trigger.userId });
    }
  }
  
  // Create enhanced context for single action execution
  const context = {
    event: trigger?.data || trigger,
    location,
    user,
    rule: null, // No rule context for single actions
    contact,
    project,
    appointment: trigger?.data?.appointment || (trigger?.data?.appointmentId ?
      await db.collection('appointments').findOne({ _id: toObjectId(trigger.data.appointmentId) }) : null),
    quote: trigger?.data?.quoteId ? await db.collection('quotes').findOne({ _id: toObjectId(trigger.data.quoteId) }) : null,
    // CHECK THE TRIGGER FOR FLAGS:
    isFromQueue: trigger?.isFromQueue || trigger?.isQueuedExecution || true,  // Default to true since this is executeSingleAction
    isQueuedExecution: trigger?.isQueuedExecution || true  // Default to true
  };

  console.log('📋 Built context for action execution:', {
    hasAppointment: !!context.appointment,
    appointmentTitle: context.appointment?.title,
    appointmentStart: context.appointment?.start
  });
  
  console.log(`Executing single action ${action.type} with enhanced context:`, {
    hasContact: !!contact,
    hasProject: !!project,
    hasLocation: !!location,
    hasUser: !!user,
    eventType: context.event?.type
  });
  
  return await handler(action, context, db);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await clientPromise;
  const db = client.db(getDbName());

  try {
    // Extract request parameters
    const { 
      ruleId,
      trigger,
      _id,
      action,
      actionType
    } = req.body;
    
    // Handle both formats - from queue processor and direct calls
    let event = req.body.event || req.body;
    
    // If we have trigger data, use that as the event
    if (req.body.trigger) {
      event = {
        ...req.body.trigger.data,
        type: req.body.trigger.type,
        locationId: req.body.trigger.locationId,
        ruleId: req.body.ruleId
      };
    }
    
    // Ensure we have a locationId
    if (!event.locationId) {
      console.error('Missing locationId in event:', event);
      return res.status(400).json({ error: 'Missing locationId' });
    }

    // If we have a specific action, execute only that action
    if (action && actionType) {
      console.log(`[Automation Execute] Executing single action: ${actionType}`);
      
      // CRITICAL: Mark this as a queued action execution
      const enhancedTrigger = {
        ...trigger,
        isFromQueue: true,  // ADD THIS
        isQueuedExecution: true  // ADD THIS
      };
      
      try {
        const result = await executeSingleAction(db, action, enhancedTrigger);  // Pass enhanced trigger
        
        // Mark queue item as completed
        if (_id) {
          await db.collection('automation_queue').updateOne(
            { _id: new ObjectId(_id) },
            {
              $set: {
                status: 'completed',
                completedAt: new Date(),
                result: result
              }
            }
          );
        }
        
        return res.status(200).json({
          success: true,
          actionType: actionType,
          result: result
        });
      } catch (error: any) {
        console.error(`[Automation Execute] Action failed:`, error);
        
        if (_id) {
          await db.collection('automation_queue').updateOne(
            { _id: new ObjectId(_id) },
            {
              $set: {
                status: 'failed',
                error: error.message,
                failedAt: new Date()
              },
              $inc: { attempts: 1 }
            }
          );
        }
        
        return res.status(500).json({
          success: false,
          error: error.message
        });
      }
    }

    // CRITICAL: Prevent re-processing of already queued automations
    const isFromQueue = !!(req.body._id && req.body.trigger && req.body.action);
    const isAlreadyProcessed = !!(event.ruleId);
    
    console.log('🔍 Automation execution source detection:');
    console.log('  - Is from queue:', isFromQueue);
    console.log('  - Is already processed:', isAlreadyProcessed);
    console.log('  - Has queue ID:', !!req.body._id);
    console.log('  - Has trigger data:', !!req.body.trigger);
    console.log('  - Has action data:', !!req.body.action);
    
    // Right after the event parsing section, add:
    console.log('Raw request body:', JSON.stringify(req.body, null, 2));
    console.log('Parsed event:', JSON.stringify(event, null, 2));
    console.log('Looking for rules with locationId:', event.locationId);
    console.log('Event type:', event.type);
    
    // Normalize event type - convert dots AND colons to dashes for consistent matching
    // This handles events from different sources:
    // - Event listeners emit: "contact:created", "project.created" 
    // - Database rules expect: "contact-created", "project-created"
    // - Normalization ensures both formats match
    const normalizedType = event.type?.replace(/[.:]/g, '-') || event.type;
    
    // Enhanced logging for event type matching
    console.log('🔍 Event type analysis:');
    console.log('  - Original event type:', event.type);
    console.log('  - Normalized type (dots/colons → dashes):', normalizedType);
    console.log('  - With colon replacement:', event.type?.replace(':', '-'));
    console.log('  - With dash replacement:', event.type?.replace('-', ':'));
    
    // CRITICAL: Handle queued automation actions vs fresh events
    if (isFromQueue || isAlreadyProcessed) {
      console.log('🎯 Processing queued automation action');
      
      // For queued items, we should STILL check conditions if we have a ruleId
      if (req.body.ruleId && req.body.action) {
        // Fetch the rule to get its conditions
        const rule = await db.collection('automation_rules').findOne({
          _id: new ObjectId(req.body.ruleId)
        });
        
        if (rule?.conditions?.length > 0) {
          const conditionsMet = await checkConditions(rule.conditions, event, db);
          console.log(`📋 [Queued Action] Rule: ${rule.name}, Conditions met: ${conditionsMet}`);
          
          if (!conditionsMet) {
            console.log('❌ Conditions not met for queued action, skipping');
            return res.json({ 
              results: [], 
              message: 'Conditions not met' 
            });
          }
        }
      }
      
      // Continue with action execution if conditions passed
      if (req.body.action) {
        console.log('Executing action:', req.body.action.type);
        const location = await db.collection('locations').findOne({ 
          locationId: event.locationId 
        });

        // IMPROVED USER LOOKUP - Check multiple fields and assignedUserId
        let user = null;
        if (event.userId) {
          user = await db.collection('users').findOne({ _id: toObjectId(event.userId) });
        }

        // If no user found, try to get assigned user from project data
        if (!user && event.data?.assignedUserId) {
          // Try GHL user ID first
          user = await db.collection('users').findOne({ ghlUserId: event.data.assignedUserId });
          
          // If not found and looks like MongoDB ObjectId, try that
          if (!user && /^[a-fA-F0-9]{24}$/.test(event.data.assignedUserId)) {
            user = await db.collection('users').findOne({ _id: toObjectId(event.data.assignedUserId) });
          }
        }

        // If still no user, try to get from project in database
        if (!user && event.data?.projectId) {
          const project = await db.collection('projects').findOne({ _id: toObjectId(event.data.projectId) });
          if (project?.assignedUserId) {
            user = await db.collection('users').findOne({ ghlUserId: project.assignedUserId });
            if (!user && /^[a-fA-F0-9]{24}$/.test(project.assignedUserId)) {
              user = await db.collection('users').findOne({ _id: toObjectId(project.assignedUserId) });
            }
          }
        }

        console.log('🔍 Queued action user lookup result:', {
          foundUser: !!user,
          userId: user?._id,
          ghlUserId: user?.ghlUserId,
          name: user?.firstName + ' ' + user?.lastName,
          lookupPath: event.userId ? 'event.userId' : event.data?.assignedUserId ? 'assignedUserId' : 'project.assignedUserId'
        });
        
        try {
          const result = await executeAction(req.body.action, event, location, user, db, { _id: req.body.ruleId });
          console.log('Action execution result:', result);
          return res.json({ 
            results: [{ success: true, actionType: req.body.action.type, result }], 
            message: 'Queued action executed'
          });
        } catch (error) {
          console.error('Action execution failed:', error);
          return res.status(500).json({ 
            error: 'Action execution failed',
            message: error.message 
          });
        }
      } else {
        console.log('🚫 No action to execute in queued item');
        return res.json({ 
          results: [], 
          message: 'No action to execute'
        });
      }
    }

    // Find matching automation rules
    const rules = await db.collection('automation_rules').find({
      locationId: event.locationId,
      isActive: true,
      $or: [
        // Match by trigger type (support all formats)
        { 'trigger.type': event.type }, // Original format
        { 'trigger.type': normalizedType }, // Normalized to dashes
        // Stage triggers with pipeline filtering
        { 
          'trigger.type': 'stage-entered', 
          'trigger.stageId': event.stageId,
          'trigger.pipelineId': event.pipelineId
        },
        // Appointment triggers with calendar filtering - ONLY for appointment events
        {
          $and: [
            { 'trigger.type': { $in: ['appointment-scheduled', 'appointment-created', 'appointment-started'] } },
            { $or: [
              event.type?.includes('appointment') ? { 'trigger.calendarIds': { $exists: false } } : { $expr: false },
              event.type?.includes('appointment') ? { 'trigger.calendarIds': event.calendarId } : { $expr: false }
            ]}
          ]
        },
        // Rule ID if passed directly from queue
        ...(event.ruleId ? [{ _id: new ObjectId(event.ruleId) }] : [])
      ]
    }).sort({ priority: -1 }).toArray();

    // Fix 9: Add detailed automation execution logging
    console.log('🔍 [Fix 9] Automation Execution Debug:');
    console.log('  Event type:', event.type);
    console.log('  Project stage:', event.pipelineStageId || 'NULL');
    console.log('  Rules found:', rules.length);
    
    // Log each rule and check conditions
    for (const rule of rules) {
      const conditionsMet = rule.conditions?.length === 0 || await checkConditions(rule.conditions, event, db);
      console.log(`  - ${rule.name || 'Unnamed'}: conditions met? ${conditionsMet}`);
      if (conditionsMet) {
        console.log(`    Actions: ${rule.actions?.length || 0}`);
        rule.actions?.forEach((action: any, index: number) => {
          console.log(`      ${index + 1}. ${action.type}: ${JSON.stringify(action.config || {})}`);
        });
      }
    }

    // Enhanced logging for rule matching
    console.log('📋 Rules found:', rules.length);
    rules.forEach((rule, index) => {
      const triggerType = rule.trigger?.type;
      const matchedBy = 
        triggerType === event.type ? 'original' :
        triggerType === normalizedType ? 'normalized' :
        'other';
      
      console.log(`  Rule ${index + 1}:`);
      console.log(`    - ID: ${rule._id}`);
      console.log(`    - Name: ${rule.name || 'Unnamed'}`);
      console.log(`    - Trigger type: ${triggerType}`);
      console.log(`    - Matched by: ${matchedBy}`);
      console.log(`    - Actions: ${rule.actions?.length || 0}`);
    });

    const results = [];

    for (const rule of rules) {
      try {
        // Check conditions
        if (rule.conditions?.length > 0) {
          const conditionsMet = await checkConditions(rule.conditions, event, db);
          if (!conditionsMet) continue;
        }

        // Execute actions - handle individual action delays
        for (const action of rule.actions) {
          // Check if this action has a delay
          if (action.config?.delay?.amount > 0) {
            // Queue this action as scheduled
            const delayMs = action.config.delay.amount * 
              (action.config.delay.unit === 'minutes' ? 60000 : 
               action.config.delay.unit === 'hours' ? 3600000 : 86400000);
            
            await db.collection('automation_queue').insertOne({
              ruleId: rule._id,
              action: action,
              actionType: action.type,
              trigger: {
                type: event.type,
                locationId: rule.locationId,
                data: event
              },
              status: 'scheduled',
              scheduledFor: new Date(Date.now() + delayMs),
              createdAt: new Date(),
              attempts: 0
            });
            
            console.log(`Scheduled action ${action.type} for ${new Date(Date.now() + delayMs)}`);
          } else {
            // Execute immediately
            const location = await db.collection('locations').findOne({ 
              locationId: rule.locationId 
            });

            // IMPROVED USER LOOKUP - Check multiple fields and assignedUserId
            let user = null;
            if (event.userId) {
              user = await db.collection('users').findOne({ _id: toObjectId(event.userId) });
            }

            // If no user found, try to get assigned user from project data
            if (!user && event.data?.assignedUserId) {
              // Try GHL user ID first
              user = await db.collection('users').findOne({ ghlUserId: event.data.assignedUserId });
              
              // If not found and looks like MongoDB ObjectId, try that
              if (!user && /^[a-fA-F0-9]{24}$/.test(event.data.assignedUserId)) {
                user = await db.collection('users').findOne({ _id: toObjectId(event.data.assignedUserId) });
              }
            }

            // If still no user, try to get from project in database
            if (!user && event.data?.projectId) {
              const project = await db.collection('projects').findOne({ _id: toObjectId(event.data.projectId) });
              if (project?.assignedUserId) {
                user = await db.collection('users').findOne({ ghlUserId: project.assignedUserId });
                if (!user && /^[a-fA-F0-9]{24}$/.test(project.assignedUserId)) {
                  user = await db.collection('users').findOne({ _id: toObjectId(project.assignedUserId) });
                }
              }
            }

            console.log('🔍 User lookup result:', {
              foundUser: !!user,
              userId: user?._id,
              ghlUserId: user?.ghlUserId,
              name: user?.firstName + ' ' + user?.lastName,
              lookupPath: event.userId ? 'event.userId' : event.data?.assignedUserId ? 'assignedUserId' : 'project.assignedUserId'
            });

            await executeAction(action, event, location, user, db, rule);
          }
        }

        // Update stats
        await db.collection('automation_rules').updateOne(
          { _id: rule._id },
          {
            $set: { 'executionStats.lastExecuted': new Date() },
            $inc: { 
              'executionStats.executionCount': 1,
              'executionStats.successCount': 1
            }
          }
        );

        results.push({ ruleId: rule._id, success: true });
      } catch (error) {
        console.error('Automation execution error:', error);
        
        await db.collection('automation_rules').updateOne(
          { _id: rule._id },
          {
            $inc: { 
              'executionStats.executionCount': 1,
              'executionStats.failureCount': 1
            }
          }
        );

        results.push({ ruleId: rule._id, success: false, error: error instanceof Error ? error.message : String(error) });
      }
    }

    return res.json({ results });
  } catch (error) {
    console.error('Execute automation error:', error);
    return res.status(500).json({ error: 'Failed to execute automation' });
  }
}

async function checkConditions(conditions: any[], event: any, db: any): Promise<boolean> {
  if (!conditions || conditions.length === 0) return true;
  
  console.log(`🔍 [Condition Check] Evaluating ${conditions.length} conditions for event:`, {
    eventType: event.type,
    eventDepositAmount: event.depositAmount,
    eventDataDepositAmount: event.data?.depositAmount,
    eventDataQuoteDepositAmount: event.data?.quoteDepositAmount
  });

  // CRITICAL FIX: Create proper context that makes depositAmount accessible
  // The event listener sends depositAmount at event.depositAmount, but we need to check event.data too
  const context = {
    // Try multiple possible locations for depositAmount
    depositAmount: event.depositAmount || event.data?.depositAmount || event.data?.quoteDepositAmount || 0,
    depositRequired: event.depositRequired || event.data?.depositRequired || event.data?.quoteDepositRequired || false,
    // Keep original event structure for other fields
    ...event,
    // Also flatten event.data to top level for easy access
    ...event.data,
    // Keep nested data structure
    data: event.data || {},
    event: event
  };

  console.log('🎯 [Condition Context] Final context depositAmount:', context.depositAmount);
  
  for (const condition of conditions) {
    let fieldValue = getNestedValue(context, condition.field);
    
    console.log(`🎯 [Condition Check] Field: ${condition.field}, Found Value: ${fieldValue}, Expected: ${condition.value}, Type: ${typeof fieldValue}`);
    
    switch (condition.operator) {
      case 'equals':
        if (fieldValue === null || fieldValue === undefined) {
          console.log(`❌ [Condition] Field ${condition.field} not found`);
          if (condition.value === null || condition.value === undefined) continue;
          return false;
        }
        const matches = fieldValue == condition.value;
        console.log(`${matches ? '✅' : '❌'} [Condition] ${fieldValue} ${condition.operator} ${condition.value} = ${matches}`);
        if (!matches) return false;
        break;
        
      case 'greater-than':
        const greaterThan = Number(fieldValue) > Number(condition.value);
        console.log(`${greaterThan ? '✅' : '❌'} [Condition] ${fieldValue} > ${condition.value} = ${greaterThan}`);
        if (!greaterThan) return false;
        break;
        
      case 'not-equals':
        if ((fieldValue ?? null) === (condition.value ?? null)) return false;
        break;
      case 'in':
        if (!condition.value?.includes(fieldValue)) return false;
        break;
      case 'not-empty':
        if (!fieldValue) return false;
        break;
      case 'empty':
        if (fieldValue) return false;
        break;
    }
  }
  return true;
}



async function executeSMS(action: any, context: any, db: Db) {
  const { config } = action;
  const { recipient, message, templateKey, templateId } = config;
  
  let toNumber = recipient === 'contact' ? context.contact?.phone : recipient;
  if (!toNumber) return { error: 'No phone number found' };
  
  // ✅ NEW: Fetch template if templateId provided
  let finalMessage = message;
  if (templateId && !message) {
    try {
      // Check if templateId is an ObjectId (from calendar automations) or a key string (from main automations)
      const isObjectId = /^[a-fA-F0-9]{24}$/.test(templateId);
      
      if (isObjectId) {
        // Legacy calendar automation - fetch individual template document
        const template = await db.collection('sms_templates').findOne({
          _id: new ObjectId(templateId)
        });
        
        if (template) {
          finalMessage = template.message;
          console.log('✅ Loaded SMS template (ObjectId):', template.name);
        } else {
          console.error('❌ SMS template not found (ObjectId):', templateId);
          return { error: 'SMS template not found' };
        }
      } else {
        // Main automations - fetch from nested templates document
        const locationId = context.location?.locationId || context.event?.locationId || context.event?.data?.locationId;
        
        const templatesDoc = await db.collection('sms_templates').findOne({
          locationId: locationId
        });
        
        if (templatesDoc?.templates?.[templateId]) {
          finalMessage = templatesDoc.templates[templateId].message;
          console.log('✅ Loaded SMS template (key):', templateId);
        } else {
          console.error('❌ SMS template not found (key):', templateId);
          return { error: 'SMS template not found' };
        }
      }
    } catch (error) {
      console.error('❌ Error loading SMS template:', error);
      return { error: 'Failed to load SMS template' };
    }
  }
  
  if (!finalMessage) {
    return { error: 'No message content provided' };
  }
  
  // CRITICAL FIX: Fetch fresh appointment data if we have an ID but no details
  if (context.event?.data?.appointmentId && !context.appointment?.start) {
    const appointmentId = context.event.data.appointmentId;
    context.appointment = await db.collection('appointments').findOne({
      _id: /^[a-fA-F0-9]{24}$/.test(appointmentId) ? toObjectId(appointmentId) : appointmentId
    });
    console.log('✅ Fetched fresh appointment data:', context.appointment);
  }

  // ✅ FIX: Map customLocation to address for variable replacement
  if (context.appointment?.customLocation && !context.appointment.address) {
    context.appointment.address = context.appointment.customLocation;
    console.log('✅ Mapped customLocation to address for SMS:', context.appointment.address);
  }

  // Transform appointment data for variable replacement WITH TIMEZONE CONVERSION
  if (context.appointment?.start || context.appointment?.startTime) {
    const utcDate = context.appointment.start || context.appointment.startTime;
    
    // Get timezone with priority: contact → user → location
    const timezone = getTimezoneWithPriority(
      context.contact,
      context.user,
      context.location
    );
    
    console.log('🌍 Using timezone for appointment:', { 
      timezone, 
      utcDate,
      contactTimezone: context.contact?.timezone,
      userTimezone: context.user?.preferences?.timezone,
      locationTimezone: context.location?.timezone || context.location?.settings?.timezone
    });
    
    // Convert and format with proper timezone
    context.appointment.date = formatDateWithTimezone(utcDate, timezone);
    context.appointment.time = formatTimeWithTimezone(utcDate, timezone);
    
    console.log('✅ Set appointment date/time with timezone:', {
      date: context.appointment.date,
      time: context.appointment.time,
      timezone
    });
  }

  // Get project address from multiple sources
  if (context.project && !context.project.address) {
    // Try contact address first
    if (context.contact?.address) {
      context.project.address = context.contact.address;
    } else if (context.appointment?.address) {
      context.project.address = context.appointment.address;
    } else if (context.appointment?.ghlPayload?.address) {
      context.project.address = context.appointment.ghlPayload.address;
    } else {
      context.project.address = 'Address on file';
    }
  }

  // CRITICAL: Get the ASSIGNED USER for this appointment
  let assignedUserId = context.appointment?.assignedTo || 
                      context.appointment?.userId ||
                      context.event?.data?.assignedTo ||
                      context.project?.assignedUserId;

  if (assignedUserId) {
    const assignedUser = await db.collection('users').findOne({
      $or: [
        { ghlUserId: assignedUserId },
        { _id: /^[a-fA-F0-9]{24}$/.test(assignedUserId) ? toObjectId(assignedUserId) : null }
      ].filter(Boolean)
    });
    
    if (assignedUser) {
      // Override context.user with the actual assigned user
      context.user = {
        ...assignedUser,
        firstName: assignedUser.firstName || assignedUser.name?.split(' ')[0] || 'Your Consultant',
        lastName: assignedUser.lastName || assignedUser.name?.split(' ').slice(1).join(' ') || '',
        phone: assignedUser.phone || assignedUser.mobilePhone || '',
        title: assignedUser.title || assignedUser.role || 'Consultant'
      };
      console.log('✅ Set assigned user for variables:', context.user.firstName, context.user.lastName);
    }
  }

  // Set location info
  if (!context.location?.name && context.event?.locationId) {
    const location = await db.collection('locations').findOne({
      locationId: context.event.locationId
    });
    if (location) {
      context.location = location;
    }
  }
  
  // Add project address from contact
  if (context.project && context.contact?.address) {
    context.project.address = context.contact.address;
  }
  
  // Add consultant info if userId exists
  if (context.appointment?.userId) {
    const user = await db.collection('users').findOne({ 
      $or: [
        { _id: toObjectId(context.appointment.userId) },
        { ghlUserId: context.appointment.userId }
      ]
    });
    if (user) {
      context.consultant = { 
        name: user.name || user.firstName || 'Team member'
      };
    }
  }
  
  finalMessage = replaceVariablesInMessage(finalMessage, context);
  
  // FIXED: Enhanced user lookup to handle all ID formats properly
  let smsUser = null;

  // 1. First try from context.user (if passed correctly)
  if (context.user?._id) {
    smsUser = context.user;
  }

  // 2. Try from project assignedUserId (GHL ID format)
  if (!smsUser && context.project?.assignedUserId) {
    smsUser = await db.collection('users').findOne({ 
      ghlUserId: context.project.assignedUserId
    });
    
    // Also try as MongoDB ObjectId if it's the right format
    if (!smsUser && /^[a-fA-F0-9]{24}$/.test(context.project.assignedUserId)) {
      smsUser = await db.collection('users').findOne({ 
        _id: toObjectId(context.project.assignedUserId)
      });
    }
  }

  // 3. Try from event userId (could be MongoDB ObjectId from automation queue)
  if (!smsUser && context.event?.userId) {
    // Check if it's MongoDB ObjectId format first
    if (/^[a-fA-F0-9]{24}$/.test(context.event.userId)) {
      smsUser = await db.collection('users').findOne({ 
        _id: toObjectId(context.event.userId)
      });
    } else {
      // Try as GHL user ID
      smsUser = await db.collection('users').findOne({ 
        ghlUserId: context.event.userId
      });
    }
  }

  // 4. Try from event.data.userId (queued automation context)
  if (!smsUser && context.event?.data?.userId) {
    if (/^[a-fA-F0-9]{24}$/.test(context.event.data.userId)) {
      smsUser = await db.collection('users').findOne({ 
        _id: toObjectId(context.event.data.userId)
      });
    } else {
      smsUser = await db.collection('users').findOne({ 
        ghlUserId: context.event.data.userId
      });
    }
  }

  // Final fallback - get any user with SMS configured in this location
  if (!smsUser) {
    smsUser = await db.collection('users').findOne({ 
      locationId: context.location?.locationId || context.event?.locationId,
      'preferences.communication.smsNumberId': { $exists: true }
    });
  }
  
  if (!smsUser) {
    console.error('❌ [executeSMS] No user found for SMS configuration check');
    console.error('  - Project assignedUserId:', context.project?.assignedUserId);
    console.error('  - Event userId:', context.event?.userId);
    console.error('  - Location ID:', context.location?.locationId || context.event?.locationId);
    return { error: 'User not found for SMS configuration check' };
  }
  
  console.log('✅ [executeSMS] Found SMS user:', {
    userId: smsUser._id,
    ghlUserId: smsUser.ghlUserId,
    name: smsUser.name || smsUser.firstName,
    hasSmsConfig: !!smsUser?.preferences?.communication?.smsNumberId
  });
  
  // CRITICAL FIX: Add the assigned user data to context for variable replacement
  // Always update context.user with the assigned user, even if context.user exists
  if (smsUser) {
    context.user = smsUser;
    console.log('✅ Set context.user for variable replacement:', {
      firstName: smsUser.firstName,
      lastName: smsUser.lastName,
      name: smsUser.name
    });
  }
  
  // Check if user has SMS configuration - but don't fail if they don't
  // The backend SMS service will handle phone number resolution
  const hasSmsConfig = smsUser?.preferences?.communication?.smsNumberId;
  
  if (!hasSmsConfig) {
    console.log('⚠️ User has no SMS number configured, but proceeding with SMS queue');
    // Continue anyway - the backend SMS service will handle fallbacks
  }
  
  // Add to SMS queue - let the backend SMS service handle phone number resolution
  const result = await db.collection('sms_queue').insertOne({
    locationId: context.location?.locationId || context.event?.locationId || context.event?.data?.locationId,
    contactId: typeof context.contact?._id === 'string' ? new ObjectId(context.contact._id) : context.contact?._id,
    ghlContactId: context.contact?.ghlContactId,
    to: toNumber,
    message: finalMessage,
    templateKey: templateKey || 'automation',
    status: 'pending',
    createdBy: 'automation',
    createdAt: new Date(),
    // Add user ID so backend can resolve phone number
    userId: smsUser?._id?.toString()
  });
  
  return { queued: true, queueId: result.insertedId };
}

async function executeEmail(action: any, context: any, db: Db) {
  const { config } = action;
  const { recipient, subject, body, templateId: configTemplateId } = config;
  
  let toEmail = recipient === 'contact' ? context.contact?.email : recipient;
  if (!toEmail) return { error: 'No email address found' };
  
  // ✅ NEW: Fetch email template if templateId provided
  let finalSubject = subject;
  let finalBody = body;
  let templateId = configTemplateId;
  
  if (configTemplateId && !body) {
    try {
      // Check if templateId is an ObjectId (24 hex chars) or a key string
      const isObjectId = /^[a-fA-F0-9]{24}$/.test(configTemplateId);
      let template = null;
      
      console.log(`🔍 Email template lookup - ID: ${configTemplateId}, isObjectId: ${isObjectId}`);
      
      if (isObjectId) {
        // Look up by ObjectId
        template = await db.collection('email_templates').findOne({
          _id: new ObjectId(configTemplateId),
          isActive: true
        });
        console.log(`🔍 Looking up email template by ObjectId: ${configTemplateId}`);
      } else {
        // Look up by key - convert kebab-case to Title Case
        // "appointment-confirmation" → "Appointment Confirmation"
        const templateName = configTemplateId
          .split('-')
          .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        
        const locationId = context.location?.locationId || context.event?.locationId || context.event?.data?.locationId;
        
        console.log(`🔍 Looking up email template by key: { templateId: ${configTemplateId}, name: ${templateName}, locationId: ${locationId} }`);
        
        // Try location-specific template first
        template = await db.collection('email_templates').findOne({
          locationId: locationId,
          name: templateName,
          isActive: true
        });
        
        // Fallback to global template
        if (!template) {
          template = await db.collection('email_templates').findOne({
            name: templateName,
            isGlobal: true,
            isActive: true
          });
        }
      }
      
      if (template) {
        finalSubject = template.subject || subject;
        finalBody = template.html || template.body || template.content;
        console.log('✅ Loaded email template:', template.name);
      } else {
        console.error('❌ Email template not found (key):', { key: configTemplateId, locationId: context.location?.locationId });
        return { error: 'Email template not found' };
      }
    } catch (error) {
      console.error('❌ Error loading email template:', error);
      return { error: 'Failed to load email template' };
    }
  }
  
  // Validate that we have content to send
  if (!finalBody && !templateId) {
    return { error: 'No email body or template specified' };
  }
  
  // CRITICAL FIX: Fetch fresh appointment data if we have an ID but no details
  if (context.event?.data?.appointmentId && !context.appointment?.start) {
    const appointmentId = context.event.data.appointmentId;
    context.appointment = await db.collection('appointments').findOne({
      _id: /^[a-fA-F0-9]{24}$/.test(appointmentId) ? toObjectId(appointmentId) : appointmentId
    });
    console.log('✅ Fetched fresh appointment data for email:', context.appointment);
  }

  // Transform appointment data for variable replacement WITH TIMEZONE CONVERSION
  if (context.appointment?.start || context.appointment?.startTime) {
    const utcDate = context.appointment.start || context.appointment.startTime;
    
    // Get timezone with priority: contact → user → location
    const timezone = getTimezoneWithPriority(
      context.contact,
      context.user,
      context.location
    );
    
    console.log('🌍 Using timezone for email appointment:', { 
      timezone, 
      utcDate,
      contactTimezone: context.contact?.timezone,
      userTimezone: context.user?.preferences?.timezone,
      locationTimezone: context.location?.timezone || context.location?.settings?.timezone
    });
    
    // Convert and format with proper timezone
    context.appointment.date = formatDateWithTimezone(utcDate, timezone);
    context.appointment.time = formatTimeWithTimezone(utcDate, timezone);
    
    console.log('✅ Set appointment date/time for email with timezone:', {
      date: context.appointment.date,
      time: context.appointment.time,
      timezone
    });
    
    // Generate Google Calendar format (YYYYMMDDTHHMMSSZ in UTC)
    const startDate = new Date(utcDate);
    const endDate = new Date(startDate.getTime() + (context.appointment.duration || 60) * 60000); // Default 1 hour
    
    const formatGoogleDate = (date: Date) => {
      return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    };
    
    context.appointment.startDateTime = formatGoogleDate(startDate);
    context.appointment.endDateTime = formatGoogleDate(endDate);
    
    console.log('✅ Set Google Calendar format:', {
      startDateTime: context.appointment.startDateTime,
      endDateTime: context.appointment.endDateTime
    });
    
    // Generate .ics download link
    const appointmentId = context.appointment._id || context.event?.data?.appointmentId;
    if (appointmentId) {
      context.calendar = {
        icsLink: `${process.env.NEXT_PUBLIC_APP_URL || 'https://api.lpai.app'}/api/calendar/generate-ics?appointmentId=${appointmentId}`
      };
      console.log('✅ Set .ics download link:', context.calendar.icsLink);
    }
  }

  // Get project address from multiple sources
  if (context.project && !context.project.address) {
    // Try contact address first
    if (context.contact?.address) {
      context.project.address = context.contact.address;
    } else if (context.appointment?.address) {
      context.project.address = context.appointment.address;
    } else if (context.appointment?.ghlPayload?.address) {
      context.project.address = context.appointment.ghlPayload.address;
    } else {
      context.project.address = 'Address on file';
    }
  }

  // CRITICAL: Get the ASSIGNED USER for this appointment
  let assignedUserId = context.appointment?.assignedTo || 
                      context.appointment?.userId ||
                      context.event?.data?.assignedTo ||
                      context.project?.assignedUserId;

  if (assignedUserId) {
    const assignedUser = await db.collection('users').findOne({
      $or: [
        { ghlUserId: assignedUserId },
        { _id: /^[a-fA-F0-9]{24}$/.test(assignedUserId) ? toObjectId(assignedUserId) : null }
      ].filter(Boolean)
    });
    
    if (assignedUser) {
      // Override context.user with the actual assigned user
      context.user = {
        ...assignedUser,
        firstName: assignedUser.firstName || assignedUser.name?.split(' ')[0] || 'Your Consultant',
        lastName: assignedUser.lastName || assignedUser.name?.split(' ').slice(1).join(' ') || '',
        phone: assignedUser.phone || assignedUser.mobilePhone || '',
        title: assignedUser.title || assignedUser.role || 'Consultant'
      };
      console.log('✅ Set assigned user for email variables:', context.user.firstName, context.user.lastName);
    }
  }

  // Set location info
  if (!context.location?.name && context.event?.locationId) {
    const location = await db.collection('locations').findOne({
      locationId: context.event.locationId
    });
    if (location) {
      context.location = location;
    }
  }
  
  // Generate conditional logo variable
  const locationLogo = context.location?.logo?.public 
    ? `<img src="${context.location.logo.public}" alt="${context.location.name}" class="header-logo" />`
    : '';

  // Generate conditional social media icon variables
  const facebookIcon = context.location?.facebookUrl
    ? `<a href="${context.location.facebookUrl}" title="Facebook"><img src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/facebook.svg" alt="Facebook" style="width: 40px; height: 40px; background: #1877F2; padding: 10px; border-radius: 50%;" /></a>`
    : '';
  
  const instagramIcon = context.location?.instagramUrl
    ? `<a href="${context.location.instagramUrl}" title="Instagram"><img src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/instagram.svg" alt="Instagram" style="width: 40px; height: 40px; background: linear-gradient(45deg, #f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%); padding: 10px; border-radius: 50%;" /></a>`
    : '';
  
  const linkedinIcon = context.location?.linkedinUrl
    ? `<a href="${context.location.linkedinUrl}" title="LinkedIn"><img src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/linkedin.svg" alt="LinkedIn" style="width: 40px; height: 40px; background: #0A66C2; padding: 10px; border-radius: 50%;" /></a>`
    : '';
  
  const twitterIcon = context.location?.twitterUrl
    ? `<a href="${context.location.twitterUrl}" title="Twitter"><img src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/x.svg" alt="X/Twitter" style="width: 40px; height: 40px; background: #000000; padding: 10px; border-radius: 50%;" /></a>`
    : '';

  // Add these to context for variable replacement
  context.locationLogo = locationLogo;
  context.facebookIcon = facebookIcon;
  context.instagramIcon = instagramIcon;
  context.linkedinIcon = linkedinIcon;
  context.twitterIcon = twitterIcon;

  finalSubject = replaceVariablesInMessage(finalSubject || 'Notification', context);

  // Use htmlContent if available, fallback to body converted to HTML
  let htmlContent = config.htmlContent || config.body || '';
  if (!config.htmlContent && config.body) {
    htmlContent = config.body
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('<br>\n');
  }

  const finalHtmlContent = replaceVariablesInMessage(finalBody || htmlContent, context);
  const finalPlainText = replaceVariablesInMessage(finalBody || config.body || config.message || '', context);

  if (!finalHtmlContent.trim() && !finalPlainText.trim()) {
    return { error: 'Email content is empty after variable replacement' };
  }
  
  // Get the user for email sending (similar to SMS)
  let emailUser = null;
  if (context.project?.assignedUserId) {
    emailUser = await db.collection('users').findOne({ 
      ghlUserId: context.project.assignedUserId
    });
    
    if (!emailUser && /^[a-fA-F0-9]{24}$/.test(context.project.assignedUserId)) {
      emailUser = await db.collection('users').findOne({ 
        _id: toObjectId(context.project.assignedUserId)
      });
    }
  }

  if (!emailUser && context.event?.userId) {
    emailUser = await db.collection('users').findOne({ 
      ghlUserId: context.event.userId
    });
  }

  if (!emailUser) {
    emailUser = await db.collection('users').findOne({ 
      locationId: context.location?.locationId || context.event?.locationId
    });
  }
  
  console.log('✅ [executeEmail] Found email user:', {
    userId: emailUser?._id,
    ghlUserId: emailUser?.ghlUserId,
    name: emailUser?.firstName + ' ' + emailUser?.lastName,
    hasEmailConfig: !!emailUser
  });
  
  // CRITICAL FIX: Add the assigned user data to context for variable replacement
  // Always update context.user with the assigned user, even if context.user exists
  if (emailUser) {
    context.user = emailUser;
    console.log('✅ Set context.user for variable replacement:', {
      firstName: emailUser.firstName,
      lastName: emailUser.lastName,
      name: emailUser.name
    });
  }

  // Add to email queue with GHL contact ID
  const result = await db.collection('email_queue').insertOne({
    locationId: context.location?.locationId || context.event?.locationId || context.event?.data?.locationId,  // FIX
    contactId: typeof context.contact?._id === 'string' ? new ObjectId(context.contact._id) : context.contact?._id,
    ghlContactId: context.contact?.ghlContactId,
    to: toEmail,
    subject: finalSubject,
    html: finalHtmlContent,
    htmlContent: finalHtmlContent,
    body: finalPlainText,
    plainTextContent: finalPlainText,
    templateId: templateId,
    status: 'pending',
    createdBy: 'automation',
    createdAt: new Date(),
    // Add user ID for email service processing
    userId: emailUser?._id?.toString() || context.user?._id?.toString() || context.event?.userId || null
  });
  
  return { queued: true, queueId: result.insertedId };
}

async function executePushNotification(action: any, context: any, db: Db) {
  console.log('📱 Executing push notification');
  console.log('Context data:', JSON.stringify(context, null, 2));
  
  // ✅ FIX: Fetch fresh appointment data if needed
  if (context.event?.data?.appointmentId && !context.appointment?.start) {
    const appointmentId = context.event.data.appointmentId;
    context.appointment = await db.collection('appointments').findOne({
      _id: /^[a-fA-F0-9]{24}$/.test(appointmentId) ? toObjectId(appointmentId) : appointmentId
    });
    console.log('✅ Fetched fresh appointment data for push:', context.appointment);
  }

  // ✅ FIX: Map customLocation to address + format appointment times
  if (context.appointment) {
    if (context.appointment.customLocation && !context.appointment.address) {
      context.appointment.address = context.appointment.customLocation;
    }
    
    // Format appointment date/time for variables
    if (context.appointment.start || context.appointment.startTime) {
      const utcDate = context.appointment.start || context.appointment.startTime;
      const timezone = getTimezoneWithPriority(context.contact, context.user, context.location);
      context.appointment.date = formatDateWithTimezone(utcDate, timezone);
      context.appointment.time = formatTimeWithTimezone(utcDate, timezone);
      console.log('✅ Set appointment date/time for push:', {
        date: context.appointment.date,
        time: context.appointment.time
      });
    }
  }
  
  const { config } = action;
  let recipientUserIds: string[] = [];
  
  // Check all possible locations for assignedTo
  if (config.recipientType === 'assigned-user' || config.recipient === 'assigned-user' || config.recipient === 'assigned') {
    let assignedTo = null;
    
    // Try to get assignedTo from various sources
    assignedTo = context.project?.assignedUserId || 
      context.project?.assignedTo ||
      context.event?.data?.assignedUserId ||
      context.event?.data?.assignedTo || 
      context.event?.assignedTo ||
      context.contact?.assignedTo;
    
    console.log('🔍 Push notification user lookup raw:', {
      foundAssignedTo: assignedTo,
      projectAssignedUserId: context.project?.assignedUserId,
      projectAssignedTo: context.project?.assignedTo
    });
    
    if (assignedTo) {
      console.log('🔍 Push notification detailed lookup for:', assignedTo);
      
      // Try to find user by GHL ID first, then by MongoDB ObjectId
      let user = await db.collection('users').findOne({ ghlUserId: assignedTo });
      console.log('   - GHL ID lookup result:', user ? 'FOUND' : 'NOT FOUND');
      
      if (!user && /^[a-fA-F0-9]{24}$/.test(assignedTo)) {
        // If assignedTo looks like a MongoDB ObjectId, try that too
        user = await db.collection('users').findOne({ _id: new ObjectId(assignedTo) });
        console.log('   - ObjectId lookup result:', user ? 'FOUND' : 'NOT FOUND');
      }
      
      if (user) {
        recipientUserIds.push(user._id.toString());
        console.log('✅ Found user for push notification:', {
          userId: user._id,
          ghlUserId: user.ghlUserId,
          name: `${user.firstName} ${user.lastName}`,
          oneSignalIds: user.oneSignalIds?.length || 0
        });
      } else {
        console.log('❌ No user found for assignedTo:', assignedTo);
        console.log('   - Searched GHL ID:', assignedTo);
        console.log('   - Is valid ObjectId format:', /^[a-fA-F0-9]{24}$/.test(assignedTo));
      }
    }
  }
  
  if (recipientUserIds.length === 0) {
    console.log('⚠️ No recipients found for push notification');
    return { error: 'No recipients found for push notification' };
  }
  
  // Get user's OneSignal player IDs
  for (const userId of recipientUserIds) {
    let targetUser = null;
    
    // Check if it's a valid MongoDB ObjectId (24 hex characters)
    if (/^[a-fA-F0-9]{24}$/.test(userId)) {
      targetUser = await db.collection('users').findOne({ 
        _id: new ObjectId(userId)
      });
      console.log(`→ Found user by MongoDB ID: ${targetUser?.email || 'not found'}`);
    }
    
    // If not found, try ghlUserId (for IDs that aren't 24 chars)
    if (!targetUser && userId.length !== 24) {
      targetUser = await db.collection('users').findOne({ 
        ghlUserId: userId 
      });
      console.log(`→ Found user by GHL ID: ${targetUser?.email || 'not found'}`);
    }
    
    if (!targetUser) {
      console.log(`⚠️ User not found with ID: ${userId} (length: ${userId.length})`);
      continue;
    }
    
    console.log(`→ Found user: ${targetUser.email || targetUser.name}`);
    
    // Get player IDs from oneSignalIds array - handle both string and object formats
    const playerIds = targetUser.oneSignalIds?.map((item: any) => 
      typeof item === 'string' ? item : item.playerId
    ).filter(Boolean) || [];
    
    if (playerIds.length === 0) {
      console.log(`      ⚠️ User ${userId} has no OneSignal player IDs`);
      continue;
    }
    
    console.log(`      → Found ${playerIds.length} player IDs for user ${targetUser.email}`);
    
    // Prepare notification content
    let title = config.template?.title || config.title || 'Notification';
    let body = config.template?.body || config.message || 'New notification';
    
    console.log(`      → Original title: "${title}"`);
    console.log(`      → Original body: "${body}"`);
    console.log(`      → Context contact data:`, {
      contactId: context.contact?._id,
      contactName: context.contact?.name,
      contactFirstName: context.contact?.firstName,
      contactLastName: context.contact?.lastName,
      contactFullName: context.contact?.fullName
    });
    
    title = replaceVariablesInMessage(title, context);
    body = replaceVariablesInMessage(body, context);
    
    console.log(`      → Processed title: "${title}"`);
    console.log(`      → Processed body: "${body}"`);
    
    // Send to all player IDs
    const notification = {
      app_id: process.env.ONESIGNAL_APP_ID,
      include_player_ids: playerIds,
      headings: { en: title },
      contents: { en: body },
      data: config.template?.data || {
        type: 'contact-assigned',
        contactId: context.event?.contactId || context.contact?._id,
        screen: 'ContactDetailScreen'
      },
      ios_badgeType: 'Increase',
      ios_badgeCount: 1,
      priority: config.template?.priority || 10
    };
    
    console.log(`      → Sending notification:`, JSON.stringify(notification, null, 2));
    
    try {
      const response = await axios.post('https://onesignal.com/api/v1/notifications', notification, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${process.env.ONESIGNAL_REST_API_KEY}`
        }
      });
      
      const result = response.data;
      console.log(`      ✅ OneSignal success:`, result);
      // Mark the trigger as processed
      if (context.event?._id) {
        await db.collection('automation_queue').updateOne(
          { _id: new ObjectId(context.event._id) },
          { $set: { status: 'completed', completedAt: new Date() } }
        );
      }
    } catch (error) {
      console.error(`      ❌ Failed to send:`, error);
    }
  }
  
  return { sent: true, recipients: recipientUserIds.length };
}

async function executeSendDailyBrief(action: any, context: any, db: Db) {
  const { recipients = 'all-users', briefType = 'daily' } = action.config;
  
  // Get users to send brief to
  let userIds: string[] = [];
  
  if (recipients === 'all-users') {
    const users = await db.collection('users').find({
      locationId: context.location?.locationId,
      isActive: true
    }).toArray();
    userIds = users.map(u => u._id.toString());
  } else if (Array.isArray(recipients)) {
    userIds = recipients;
  }
  
  if (userIds.length === 0) {
    return { error: 'No recipients found for daily brief' };
  }
  
  // Generate brief content based on type
  let briefContent = '';
  let briefTitle = '';
  
  switch (briefType) {
    case 'daily':
      briefTitle = '📊 Daily Brief';
      // Get today's stats
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      
      const newContacts = await db.collection('contacts').countDocuments({
        locationId: context.location?.locationId,
        createdAt: { $gte: startOfDay }
      });
      
      const newProjects = await db.collection('projects').countDocuments({
        locationId: context.location?.locationId,
        createdAt: { $gte: startOfDay }
      });
      
      briefContent = `Today's Activity:\n• New Contacts: ${newContacts}\n• New Projects: ${newProjects}`;
      break;
      
    default:
      briefTitle = '📋 Brief';
      briefContent = 'Daily summary available';
  }
  
  // Send to all recipients
  const notifications = userIds.map(userId => ({
    userId,
    message: briefContent,
    priority: 'normal',
    entityType: 'general',
    entityId: null,
    locationId: context.location?.locationId,
    status: 'unread',
    createdAt: new Date(),
    createdBy: 'automation'
  }));
  
  const result = await db.collection('internal_notifications').insertMany(notifications);
  
  // Send push notifications if users have OneSignal IDs
  for (const notification of notifications) {
    const user = await db.collection('users').findOne({ _id: new ObjectId(notification.userId) });
    if (user?.oneSignalIds?.length > 0) {
      const playerIds = user.oneSignalIds.map((item: any) => 
        typeof item === 'string' ? item : item.playerId
      ).filter(Boolean);
      
      if (playerIds.length > 0) {
        try {
          await axios.post('https://onesignal.com/api/v1/notifications', {
            app_id: process.env.ONESIGNAL_APP_ID,
            include_player_ids: playerIds,
            headings: { en: briefTitle },
            contents: { en: briefContent },
            data: { type: 'daily-brief', briefType }
          }, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Basic ${process.env.ONESIGNAL_REST_API_KEY}`
            }
          });
        } catch (error) {
          console.error('Failed to send push notification for daily brief:', error);
        }
      }
    }
  }
  
  return { sent: true, count: result.insertedCount, recipients: userIds.length };
}



async function executeMoveToStage(action: any, context: any, db: Db) {
  const { stageId, pipelineId } = action.config;
  
  // Get projectId from various possible locations
  const projectId = context.project?._id || 
                   context.event?.projectId || 
                   context.event?.data?.projectId;
  
  console.log('executeMoveToStage Debug:', {
    configStageId: stageId,
    configPipelineId: pipelineId,
    projectId: projectId,
    projectIdType: typeof projectId,
    contextProject: context.project
  });
  
  if (!stageId || !projectId) {
    console.error('Missing stageId or projectId for move-to-stage action');
    return { error: 'Missing stageId or projectId' };
  }
  
  // Ensure we're using ObjectId
  const objectId = toObjectId(projectId);
  
  const updateResult = await db.collection('projects').updateOne(
    { _id: objectId },
    { 
      $set: { 
        pipelineStageId: stageId,
        pipelineId: pipelineId || context.project?.pipelineId,
        stageUpdatedAt: new Date(),
        lastAutomationUpdate: new Date()
      }
    }
  );
  
  console.log('MongoDB Update Result:', {
    matchedCount: updateResult.matchedCount,
    modifiedCount: updateResult.modifiedCount,
    acknowledged: updateResult.acknowledged,
    searchedFor: objectId.toString()
  });
  
  if (updateResult.matchedCount === 0) {
    console.error('No project matched the query!');
    // Try to find what's in the database
    const checkProject = await db.collection('projects').findOne({ _id: objectId });
    console.log('Project exists?', !!checkProject);
  }
  
  if (updateResult.modifiedCount > 0) {
    // Get fresh project data for GHL sync
    const updatedProject = await db.collection('projects').findOne({ _id: objectId });
    
    // Sync to GHL if project has ghlOpportunityId
    if (updatedProject?.ghlOpportunityId && context.location) {
      try {
        console.log(`[executeMoveToStage] Syncing stage change to GHL:`, {
          opportunityId: updatedProject.ghlOpportunityId,
          newStageId: stageId,
          projectId: objectId.toString()
        });
        
        const auth = await getAuthHeader(context.location);
        
        // Update opportunity stage in GHL
        const ghlPayload = {
          pipelineStageId: stageId,
          ...(pipelineId && { pipelineId: pipelineId }) // Only include pipelineId if provided
        };
        
        const ghlResponse = await axios.put(
          `https://services.leadconnectorhq.com/opportunities/${updatedProject.ghlOpportunityId}`,
          ghlPayload,
          {
            headers: {
              'Authorization': auth.header,
              'Version': '2021-07-28',
              'Content-Type': 'application/json'
            }
          }
        );
        
        console.log(`[executeMoveToStage] GHL stage sync successful:`, {
          opportunityId: updatedProject.ghlOpportunityId,
          newStageId: stageId,
          response: ghlResponse.data
        });
        
        // Add timeline entry for successful sync
        await db.collection('projects').updateOne(
          { _id: objectId },
          {
            $push: {
              timeline: {
                id: new ObjectId().toString(),
                event: 'ghl_stage_synced',
                description: `Stage synced to GoHighLevel via automation: ${stageId}`,
                timestamp: new Date().toISOString(),
                metadata: {
                  ghlOpportunityId: updatedProject.ghlOpportunityId,
                  newStageId: stageId,
                  syncMethod: 'automation',
                  actionType: 'move-to-stage'
                }
              }
            }
          }
        );
        
      } catch (ghlError: any) {
        console.error('[executeMoveToStage] GHL stage sync failed:', {
          error: ghlError.message,
          response: ghlError.response?.data,
          status: ghlError.response?.status,
          opportunityId: updatedProject.ghlOpportunityId
        });
        
        // Add timeline entry for failed sync
        await db.collection('projects').updateOne(
          { _id: objectId },
          {
            $push: {
              timeline: {
                id: new ObjectId().toString(),
                event: 'ghl_sync_failed',
                description: `Failed to sync stage to GoHighLevel via automation: ${ghlError.message}`,
                timestamp: new Date().toISOString(),
                metadata: {
                  error: ghlError.message,
                  status: ghlError.response?.status,
                  ghlOpportunityId: updatedProject.ghlOpportunityId,
                  attemptedStageId: stageId,
                  syncMethod: 'automation',
                  actionType: 'move-to-stage'
                }
              }
            }
          }
        );
        
        // Continue with success despite GHL sync failure
        console.log('[executeMoveToStage] Continuing despite GHL sync failure');
      }
    } else {
      console.log('[executeMoveToStage] No GHL sync needed - missing ghlOpportunityId or location');
    }
    
    // ADD REAL-TIME UPDATE FOR MOVE-TO-STAGE
    const isFromQueueForRealtime = context.isFromQueue || context.isQueuedExecution || 
                                  !!(context.event?._id && context.event?.trigger && context.event?.action);
    const isAlreadyProcessedForRealtime = !!(context.event?.ruleId);
    
    if (!isFromQueueForRealtime && !isAlreadyProcessedForRealtime) {
      try {
        const Ably = require('ably');
        const ably = new Ably.Rest(process.env.ABLY_API_KEY);
        const locationId = context.location?.locationId || context.event?.locationId;
        const channel = ably.channels.get(`location:${locationId}:projects`);
        
        await channel.publish('project.stage.updated', {
          projectId: objectId.toString(),
          pipelineStageId: stageId,
          pipelineId: pipelineId || updatedProject?.pipelineId,
          updatedAt: new Date(),
          projectTitle: updatedProject?.title || context.project?.title || 'Project',
          source: 'automation',
          actionType: 'move-to-stage'
        });
        
        console.log('✅ [executeMoveToStage] Real-time update sent for stage change');
      } catch (error) {
        console.error('❌ [executeMoveToStage] Failed to send real-time update:', error);
      }
    } else {
      // Publish Ably event for real-time UI updates
      try {
        const ably = require('ably').Realtime.Promise(process.env.ABLY_API_KEY);
        
        await ably.channels.get(`location:${context.locationId}`).publish('project.stage.changed', {
          projectId: context.data.projectId,
          pipelineId: config.pipelineId,
          stageId: config.stageId,
          stageName: 'Site Visit Scheduled', // You could look this up from pipeline data
          timestamp: new Date().toISOString(),
          triggeredBy: 'automation'
        });
        
        console.log('✅ [executeMoveToStage] Published real-time stage change event');
      } catch (ablyError) {
        console.error('❌ [executeMoveToStage] Failed to publish Ably event:', ablyError);
      }
    }
    
    // ADD AUTOMATION QUEUE PROCESSOR NOTIFICATION
    if (updatedProject?.ghlOpportunityId) {
      try {
        await db.collection('automation_queue').insertOne({
          ruleId: context.rule?._id || new ObjectId(),
          actionType: 'stage-changed-notification',
          trigger: {
            type: 'project.stage.changed',
            locationId: context.location?.locationId || context.event?.locationId,
            data: {
              projectId: objectId.toString(),
              oldStage: context.project?.pipelineStageId,
              newStage: stageId,
              pipelineId: pipelineId || context.project?.pipelineId,
              ghlOpportunityId: updatedProject.ghlOpportunityId,
              source: 'automation-move-to-stage'
            }
          },
          status: 'pending',
          scheduledFor: new Date(),
          createdAt: new Date(),
          attempts: 0,
          priority: 2
        });
        
        console.log('✅ [executeMoveToStage] Queued stage change notification for processor');
      } catch (error) {
        console.error('❌ [executeMoveToStage] Failed to queue stage change notification:', error);
      }
    }
    
    console.log('✅ Stage change completed successfully');
    return { moved: true, toStage: stageId, synced: !!updatedProject?.ghlOpportunityId };
  }
  
  return { error: 'Failed to update project stage' };
}

async function executeTransitionPipeline(action: any, context: any, db: Db) {
  console.log('🔍 [executeTransitionPipeline] Starting with:');
  console.log('  - Action config:', JSON.stringify(action.config, null, 2));
  console.log('  - Context event:', JSON.stringify(context.event, null, 2));
  
  const { toPipelineId, toStageId } = action.config;
  
  // For quote-signed events, we need to get the project from the quote
  let projectId = context.project?._id || 
                  context.event?.projectId || 
                  context.event?.data?.projectId || 
                  context.event?.data?.project?._id;
  
  // Convert to ObjectId if it's a string
  if (projectId && typeof projectId === 'string') {
    try {
      projectId = new ObjectId(projectId);
    } catch (e) {
      console.error('Invalid project ID format:', projectId);
      return { error: 'Invalid project ID format' };
    }
  }
  
  // Transform data for variable replacement (ADD THIS SECTION)
  if (context.appointment?.start) {
    const appointmentDate = new Date(context.appointment.start);
    context.appointment.date = appointmentDate.toLocaleDateString();
    context.appointment.time = appointmentDate.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  }
  
  if (context.project && context.contact?.address) {
    context.project.address = context.contact.address;
  }
  
  // Only look up consultant if we have a valid userId and it's needed for messages
  if (context.appointment?.userId || context.project?.assignedUserId) {
    const userId = context.appointment?.userId || context.project?.assignedUserId;
    
    // Check if userId is a valid MongoDB ObjectId format (24 hex characters)
    // GHL user IDs are typically NOT valid ObjectIds (e.g., "UflDPM1zkSDhrgJUBjZm")
    let user = null;
    
    if (/^[a-fA-F0-9]{24}$/.test(userId)) {
      // Valid ObjectId format - can search by both _id and ghlUserId
      user = await db.collection('users').findOne({ 
        $or: [
          { _id: toObjectId(userId) },
          { ghlUserId: userId }
        ]
      });
    } else {
      // Not a valid ObjectId - only search by ghlUserId
      user = await db.collection('users').findOne({ 
        ghlUserId: userId 
      });
    }
    
    if (user) {
      context.consultant = { 
        name: user.name || user.firstName || 'Team member',
        phone: user.phone,
        email: user.email
      };
    }
  }
  // END OF NEW SECTION
  
  // If this is a quote-signed event, get project from quote
  if (!projectId && context.event?.type === 'quote-signed' && context.event?.data?.quote) {
    const quoteData = context.event.data.quote;
    projectId = quoteData.projectId;
    
    // If still no projectId, fetch the quote from DB
    if (!projectId && quoteData._id) {
      const quote = await db.collection('quotes').findOne({ 
        _id: toObjectId(quoteData._id) 
      });
      projectId = quote?.projectId;
    }
  }
  
  // If still no projectId, try to find from quote context
  if (!projectId && context.quote?._id) {
    const quoteId = typeof context.quote._id === 'string' 
      ? new ObjectId(context.quote._id) 
      : context.quote._id;
    const quote = await db.collection('quotes').findOne({ 
      _id: quoteId
    });
    projectId = quote?.projectId;
  }
  
  // If STILL no projectId, create a new project for this quote
  if (!projectId && context.event?.type === 'quote-signed') {
    console.log('  - Creating new project for signed quote');
    const quoteData = context.event.data?.quote;
    const contactData = context.event.data?.contact;
    
    const newProject = {
      locationId: context.location?.locationId || context.event.locationId,
      contactId: contactData?._id || context.contact?._id,
      pipelineId: toPipelineId,
      pipelineStageId: toStageId,
      name: `Project from Quote ${quoteData?._id}`,
      status: 'active',
      source: 'quote-signed',
      quoteId: quoteData?._id,
      value: quoteData?.total || 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await db.collection('projects').insertOne(newProject);
    projectId = result.insertedId;
    console.log('  - Created new project:', projectId);
  }
  
  if (!toPipelineId || !toStageId) {
    console.error('❌ Missing pipeline or stage configuration');
    return { error: 'Missing pipeline or stage configuration' };
  }
  
  if (!projectId) {
    console.error('❌ Cannot find or create projectId for pipeline transition');
    return { error: 'Cannot find projectId for pipeline transition' };
  }
  
  console.log('✅ Updating project with pipeline transition...');
  console.log('  - Project ID:', projectId);
  console.log('  - New Pipeline ID:', toPipelineId);
  console.log('  - New Stage ID:', toStageId);
  
  const updateResult = await db.collection('projects').updateOne(
    { _id: toObjectId(projectId) },
    { 
      $set: { 
        pipelineId: toPipelineId,
        pipelineStageId: toStageId,
        status: 'active',
        pipelineTransitionedAt: new Date(),
        lastAutomationUpdate: new Date()
      },
      $push: {
        timeline: {
          id: new ObjectId().toString(),
          event: 'pipeline_transitioned',
          description: `Moved to pipeline ${toPipelineId} via automation`,
          timestamp: new Date().toISOString(),
          metadata: {
            fromPipeline: context.project?.pipelineId || context.event?.pipelineId,
            toPipeline: toPipelineId,
            toStage: toStageId,
            trigger: context.event?.type,
            automationAction: action.type
          }
        }
      }
    }
  );
  
  console.log('📊 Update result:', {
    matchedCount: updateResult.matchedCount,
    modifiedCount: updateResult.modifiedCount
  });
  
  if (updateResult.modifiedCount > 0) {
    console.log(`✅ Successfully transitioned project ${projectId}`);
    
    // Get fresh project data for GHL sync
    const updatedProject = await db.collection('projects').findOne({ _id: toObjectId(projectId) });
    
    // Sync to GHL if configured (OAuth or API key)
    if (context.location && updatedProject?.ghlOpportunityId) {
      try {
        console.log(`[executeTransitionPipeline] Syncing pipeline transition to GHL:`, {
          opportunityId: updatedProject.ghlOpportunityId,
          newPipelineId: toPipelineId,
          newStageId: toStageId,
          projectId: projectId.toString()
        });
        
        // Use the getAuthHeader utility that handles OAuth and API keys
        const auth = await getAuthHeader(context.location);
        console.log(`🔑 Using ${auth.type} authentication for GHL pipeline sync`);
        
        const ghlApiUrl = `https://services.leadconnectorhq.com/opportunities/${updatedProject.ghlOpportunityId}`;
        
        const ghlResponse = await axios.put(
          ghlApiUrl,
          { 
            pipelineId: toPipelineId,
            pipelineStageId: toStageId,
            status: 'open' // Required field for PUT
          },
          {
            headers: {
              'Authorization': auth.header,
              'Content-Type': 'application/json',
              'Version': '2021-07-28'
            }
          }
        );
        
        console.log('✅ GHL pipeline transition sync successful:', {
          opportunityId: updatedProject.ghlOpportunityId,
          newPipelineId: toPipelineId,
          newStageId: toStageId,
          response: ghlResponse.data
        });
        
        // Add timeline entry for successful sync
        await db.collection('projects').updateOne(
          { _id: toObjectId(projectId) },
          {
            $push: {
              timeline: {
                id: new ObjectId().toString(),
                event: 'ghl_pipeline_synced',
                description: `Pipeline transition synced to GoHighLevel via automation: ${toPipelineId}/${toStageId}`,
                timestamp: new Date().toISOString(),
                metadata: {
                  ghlOpportunityId: updatedProject.ghlOpportunityId,
                  newPipelineId: toPipelineId,
                  newStageId: toStageId,
                  syncMethod: 'automation',
                  actionType: 'transition-pipeline'
                }
              }
            }
          }
        );
        
      } catch (ghlError: any) {
        console.error('[executeTransitionPipeline] GHL pipeline sync failed:', {
          error: ghlError.message,
          response: ghlError.response?.data,
          status: ghlError.response?.status,
          opportunityId: updatedProject.ghlOpportunityId
        });
        
        // Add timeline entry for failed sync
        await db.collection('projects').updateOne(
          { _id: toObjectId(projectId) },
          {
            $push: {
              timeline: {
                id: new ObjectId().toString(),
                event: 'ghl_sync_failed',
                description: `Failed to sync pipeline transition to GoHighLevel via automation: ${ghlError.message}`,
                timestamp: new Date().toISOString(),
                metadata: {
                  error: ghlError.message,
                  status: ghlError.response?.status,
                  ghlOpportunityId: updatedProject.ghlOpportunityId,
                  attemptedPipelineId: toPipelineId,
                  attemptedStageId: toStageId,
                  syncMethod: 'automation',
                  actionType: 'transition-pipeline'
                }
              }
            }
          }
        );
        
        // Don't fail the automation if GHL sync fails
        console.log('[executeTransitionPipeline] Continuing despite GHL sync failure');
      }
    } else {
      console.log('[executeTransitionPipeline] No GHL sync needed - missing ghlOpportunityId or location');
    }
    
    // ADD REAL-TIME UPDATE HERE (same as executeMoveToStage) - but only for fresh events, not queued ones
    const isFromQueueForRealtime = context.isFromQueue || context.isQueuedExecution || 
                                  !!(context.event?._id && context.event?.trigger && context.event?.action);
    const isAlreadyProcessedForRealtime = !!(context.event?.ruleId);
    
    if (!isFromQueueForRealtime && !isAlreadyProcessedForRealtime) {
      try {
        const Ably = require('ably');
        const ably = new Ably.Rest(process.env.ABLY_API_KEY);
        const channel = ably.channels.get(`location:${context.location?.locationId || context.event?.locationId}:projects`);
        
        await channel.publish('project.stage.updated', {
          projectId: projectId.toString(),
          pipelineStageId: toStageId,
          pipelineId: toPipelineId,
          updatedAt: new Date(),
          projectTitle: context.project?.title || `Project from Quote`
        });
        
        console.log('Real-time update sent for pipeline transition');
      } catch (error) {
        console.error('Failed to send real-time update:', error);
      }
    } else {
      // Publish Ably event for real-time UI updates
      try {
        const ably = require('ably').Realtime.Promise(process.env.ABLY_API_KEY);
        
        await ably.channels.get(`location:${context.locationId}`).publish('project.stage.changed', {
          projectId: projectId.toString(),
          pipelineId: toPipelineId,
          stageId: toStageId,
          stageName: 'Site Visit Scheduled', // You could look this up from pipeline data
          timestamp: new Date().toISOString(),
          triggeredBy: 'automation'
        });
        
        console.log('✅ Published real-time stage change event for pipeline transition');
      } catch (ablyError) {
        console.error('❌ Failed to publish Ably event for pipeline transition:', ablyError);
      }
    }
    
    // Emit event for cascading automations - BUT ONLY for fresh events, not queued ones
    // Check if this is from the automation queue to prevent infinite loops
    const isFromQueue = context.isFromQueue || context.isQueuedExecution || 
                       !!(context.event?._id && context.event?.trigger && context.event?.action);
    const isAlreadyProcessed = !!(context.event?.ruleId);
    
    if (!isFromQueue && !isAlreadyProcessed) {
      console.log('✅ Emitting cascading automation event (fresh trigger)');
      eventBus.emit('project.pipeline.changed', {
        projectId: projectId.toString(),
        fromPipeline: context.project?.pipelineId,
        toPipeline: toPipelineId,
        toStage: toStageId,
        locationId: context.location?.locationId || context.event?.locationId
      });
    } else {
      console.log('🚫 Skipping event emission - this is a queued automation action');
    }
    
    // ADD AUTOMATION QUEUE PROCESSOR NOTIFICATION FOR PIPELINE TRANSITION
    if (updatedProject?.ghlOpportunityId) {
      try {
        await db.collection('automation_queue').insertOne({
          ruleId: context.rule?._id || new ObjectId(),
          actionType: 'pipeline-transitioned-notification',
          trigger: {
            type: 'project.pipeline.changed',
            locationId: context.location?.locationId || context.event?.locationId,
            data: {
              projectId: projectId.toString(),
              fromPipeline: context.project?.pipelineId,
              toPipeline: toPipelineId,
              toStage: toStageId,
              ghlOpportunityId: updatedProject.ghlOpportunityId,
              source: 'automation-transition-pipeline'
            }
          },
          status: 'pending',
          scheduledFor: new Date(),
          createdAt: new Date(),
          attempts: 0,
          priority: 2
        });
        
        console.log('✅ [executeTransitionPipeline] Queued pipeline transition notification for processor');
      } catch (error) {
        console.error('❌ [executeTransitionPipeline] Failed to queue pipeline transition notification:', error);
      }
    }
    
    return { transitioned: true, toPipelineId, toStageId, projectId: projectId.toString() };
  } else {
    console.error(`❌ Failed to transition project ${projectId}`);
    return { error: 'No documents modified' };
  }
}

async function executeCreateTask(action: any, context: any, db: Db) {
  const finalTitle = replaceVariablesInMessage(
    action.config.taskTitle || action.config.title, 
    context
  );
  const finalDescription = replaceVariablesInMessage(
    action.config.taskDescription || action.config.description, 
    context
  );
  
  const task = {
    title: finalTitle,
    description: finalDescription,
    assignedTo: action.config.assignee === 'assigned' ? context.event?.assignedUserId : action.config.specificUserId,
    locationId: context.location?._id || context.location?.locationId || context.event?.locationId,
    contactId: context.contact?._id,
    projectId: context.project?._id,
    dueDate: action.config.dueDate ? new Date(action.config.dueDate) : null,
    priority: action.config.priority || 'normal',
    status: 'pending',
    createdBy: context.user?._id || 'automation',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await db.collection('tasks').insertOne(task);
  return { created: true, taskId: result.insertedId };
}

async function executeScheduleTask(action: any, context: any, db: Db) {
  // Similar to create task but with scheduled date
  return await executeCreateTask(action, context, db);
}

async function executeAddTag(action: any, context: any, db: Db) {
  if (context.contact?._id && action.config.tagId) {
    await db.collection('contacts').updateOne(
      { _id: context.contact._id },
      { 
        $addToSet: { tags: action.config.tagId },
        $set: { lastModified: new Date() }
      }
    );
    return { added: true, tagId: action.config.tagId };
  }
  return { error: 'No contact found or tagId not specified' };
}

async function executeRemoveTag(action: any, context: any, db: Db) {
  if (context.contact?._id && action.config.tagId) {
    await db.collection('contacts').updateOne(
      { _id: context.contact._id },
      { 
        $pull: { tags: action.config.tagId },
        $set: { lastModified: new Date() }
      }
    );
    return { removed: true, tagId: action.config.tagId };
  }
  return { error: 'No contact found or tagId not specified' };
}

async function executeUpdateCustomField(action: any, context: any, db: Db) {
  if (context.contact?._id && action.config.fieldName && action.config.fieldValue !== undefined) {
    await db.collection('contacts').updateOne(
      { _id: context.contact._id },
      { 
        $set: { 
          [`customFields.${action.config.fieldName}`]: action.config.fieldValue,
          lastModified: new Date()
        }
      }
    );
    return { updated: true, field: action.config.fieldName, value: action.config.fieldValue };
  }
  return { error: 'No contact found or field configuration incomplete' };
}

// Generic field updater
async function executeUpdateField(action: any, context: any, db: Db) {
  const { entityType, fieldName, fieldValue, operation = 'set' } = action.config;
  
  const collections = {
    'contact': 'contacts',
    'project': 'projects',
    'appointment': 'appointments',
    'quote': 'quotes',
    'invoice': 'invoices'
  };
  
  const collection = collections[entityType];
  const entityId = context[entityType]?._id;
  
  if (!collection || !entityId) return { error: 'Invalid entity' };
  
  let update = {};
  switch (operation) {
    case 'set':
      update = { $set: { [fieldName]: fieldValue } };
      break;
    case 'increment':
      update = { $inc: { [fieldName]: Number(fieldValue) } };
      break;
    case 'append':
      update = { $push: { [fieldName]: fieldValue } };
      break;
    case 'remove':
      update = { $pull: { [fieldName]: fieldValue } };
      break;
  }
  
  await db.collection(collection).updateOne({ _id: entityId }, update);
  return { updated: true, field: fieldName, value: fieldValue, operation };
}

async function executeIncrementField(action: any, context: any, db: Db) {
  const { entityType, fieldName, incrementBy = 1 } = action.config;
  
  const collections = {
    'contact': 'contacts',
    'project': 'projects',
    'appointment': 'appointments',
    'quote': 'quotes',
    'invoice': 'invoices'
  };
  
  const collection = collections[entityType];
  const entityId = context[entityType]?._id;
  
  if (!collection || !entityId) return { error: 'Invalid entity' };
  
  await db.collection(collection).updateOne(
    { _id: entityId },
    { $inc: { [fieldName]: Number(incrementBy) } }
  );
  
  return { incremented: true, field: fieldName, by: incrementBy };
}

async function executeWebhook(action: any, context: any) {
  if (action.config.webhookUrl) {
    try {
      await axios.post(action.config.webhookUrl, {
        event: context.event,
        context,
        timestamp: new Date().toISOString()
      }, {
        timeout: 10000 // 10 second timeout
      });
      return { sent: true, webhookUrl: action.config.webhookUrl };
    } catch (error) {
      console.error('Webhook execution failed:', error);
      return { error: 'Webhook execution failed', details: error instanceof Error ? error.message : String(error) };
    }
  }
  return { error: 'No webhook URL specified' };
}

// Document Generation Actions
async function executeGenerateQuote(action: any, context: any, db: Db) {
  const { templateId, items = [], validDays = 30 } = action.config;
  
  if (!context.contact?._id || !context.project?._id) {
    return { error: 'Contact and project required for quote generation' };
  }
  
  // Process items with variable replacement
  const processedItems = items.map((item: any) => ({
    ...item,
    description: item.description ? replaceVariablesInMessage(item.description, context) : item.description,
    notes: item.notes ? replaceVariablesInMessage(item.notes, context) : item.notes
  }));
  
  const quote = {
    contactId: context.contact._id,
    projectId: context.project._id,
    locationId: context.location.locationId,
    items: processedItems,
    total: processedItems.reduce((sum: number, item: any) => sum + (item.amount || 0), 0),
    status: 'draft',
    validUntil: new Date(Date.now() + validDays * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    createdBy: 'automation'
  };
  
  const result = await db.collection('quotes').insertOne(quote);
  
  return { generated: true, quoteId: result.insertedId, total: quote.total };
}

async function executeGenerateInvoice(action: any, context: any, db: Db) {
  const { useExisting, invoiceId: configInvoiceId, createNew, items = [] } = action.config;
  
  let invoice;
  let invoiceId; // Declare at function scope
  
  if (useExisting && configInvoiceId) {
    invoice = await db.collection('invoices').findOne({ _id: new ObjectId(configInvoiceId) });
    invoiceId = invoice?._id; // Set from existing invoice
  } else if (createNew) {
    // Process items with variable replacement
    const processedItems = items.map((item: any) => ({
      ...item,
      description: item.description ? replaceVariablesInMessage(item.description, context) : item.description,
      notes: item.notes ? replaceVariablesInMessage(item.notes, context) : item.notes
    }));
    
    // Create invoice
    invoice = {
      contactId: context.contact?._id,
      projectId: context.project?._id,
      locationId: context.location.locationId,
      items: processedItems,
      total: processedItems.reduce((sum: number, item: any) => sum + (item.amount || 0), 0),
      status: 'pending',
      createdAt: new Date(),
      createdBy: 'automation'
    };
    
    const result = await db.collection('invoices').insertOne(invoice);
    invoiceId = result.insertedId; // Set from new invoice
  }
  
  // Send via your existing invoice send endpoint
  if (!invoiceId) {
    return { error: 'No invoice ID available for sending' };
  }
  
  try {
    const response = await axios.post(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/invoices/send`, {
      invoiceId: invoiceId,
      email: context.contact?.email
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (response.status === 200) {
      return { sent: true, invoiceId: invoiceId };
    } else {
      return { error: 'Invoice send failed', invoiceId: invoiceId };
    }
  } catch (error) {
    return { error: 'Invoice send failed', invoiceId: invoiceId, details: error instanceof Error ? error.message : String(error) };
  }
}

async function executeGenerateContract(action: any, context: any, db: Db) {
  const { templateId, terms = {}, validDays = 90 } = action.config;
  
  if (!context.contact?._id || !context.project?._id) {
    return { error: 'Contact and project required for contract generation' };
  }
  
  const contract = {
    contactId: context.contact._id,
    projectId: context.project._id,
    locationId: context.location.locationId,
    templateId: templateId,
    terms: terms,
    status: 'draft',
    validUntil: new Date(Date.now() + validDays * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    createdBy: 'automation'
  };
  
  const result = await db.collection('contracts').insertOne(contract);
  
  return { generated: true, contractId: result.insertedId };
}

// Utility Actions
async function executeAddNote(action: any, context: any, db: Db) {
  const { note, noteType = 'general' } = action.config;
  
  if (!note) return { error: 'No note content provided' };
  
  const noteDoc = {
    content: replaceVariablesInMessage(note, context),
    type: noteType,
    entityType: context.contact ? 'contact' : context.project ? 'project' : 'general',
    entityId: context.contact?._id || context.project?._id,
    locationId: context.location.locationId,
    createdBy: context.user?._id || 'automation',
    createdAt: new Date()
  };
  
  const result = await db.collection('notes').insertOne(noteDoc);
  
  return { added: true, noteId: result.insertedId, content: noteDoc.content };
}

async function executeLogActivity(action: any, context: any, db: Db) {
  const { activityType, description, metadata = {} } = action.config;
  
  const activity = {
    type: activityType,
    description: replaceVariablesInMessage(description, context),
    metadata: {
      ...metadata,
      automationRule: context.rule?.name || context.rule?._id,
      trigger: context.event?.type
    },
    entityType: context.contact ? 'contact' : context.project ? 'project' : 'general',
    entityId: context.contact?._id || context.project?._id,
    locationId: context.location.locationId,
    createdBy: 'automation',
    createdAt: new Date()
  };
  
  const result = await db.collection('activities').insertOne(activity);
  
  return { logged: true, activityId: result.insertedId, type: activityType };
}

async function executeCompleteTask(action: any, context: any, db: Db) {
  const { taskId, completionNotes } = action.config;
  
  if (!taskId) return { error: 'No task ID provided' };
  
  const updateData: any = {
    status: 'completed',
    completedAt: new Date(),
    completedBy: context.user?._id || 'automation'
  };
  
  if (completionNotes) {
    updateData.completionNotes = replaceVariablesInMessage(completionNotes, context);
  }
  
  await db.collection('tasks').updateOne(
    { _id: new ObjectId(taskId) },
    { $set: updateData }
  );
  
  return { completed: true, taskId };
}

async function executeInternalNotification(action: any, context: any, db: Db) {
  const { recipients, message, priority = 'normal', subject } = action.config;
  
  let recipientUserIds: string[] = [];
  
  // Parse recipients
  if (recipients === 'assigned-user') {
    const assignedTo = context.contact?.assignedTo || context.project?.assignedUserId;
    if (assignedTo) recipientUserIds.push(assignedTo);
  } else if (recipients === 'location-team' || recipients === 'all-users') {
    // Get all users for this location
    const users = await db.collection('users').find({
      locationId: context.location?.locationId || context.event?.locationId
    }).toArray();
    recipientUserIds = users.map(u => u._id.toString());
  } else if (Array.isArray(recipients)) {
    recipientUserIds = recipients;
  }
  
  if (recipientUserIds.length === 0) {
    console.log('[Internal Notification] No recipients found for:', recipients);
    return { error: 'No recipients found' };
  }
  
  console.log('[Internal Notification] Found recipients:', recipientUserIds.length);
  
  // Send via Resend (same pattern as onboard/emails.ts)
  try {
    const processedMessage = replaceVariablesInMessage(message, context);
    const processedSubject = subject ? replaceVariablesInMessage(subject, context) : 'Team Notification';
    
    // Get user emails
    const users = await db.collection('users').find({
      _id: { $in: recipientUserIds.map(id => new ObjectId(id)) }
    }).toArray();
    
    const emails = users.map(u => u.email).filter(Boolean);
    
    if (emails.length === 0) {
      console.log('[Internal Notification] No email addresses found for users');
      return { error: 'No email addresses found' };
    }
    
    // Check if we have Resend configured (same check as onboard/emails.ts)
    if (!process.env.RESEND_API_KEY) {
      console.log('[Internal Notification] RESEND_API_KEY not configured');
      return { error: 'Email service not configured' };
    }
    
    // Import Resend the same way as onboard/emails.ts
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    
    // Send notification email
    const emailResponse = await resend.emails.send({
      from: 'LPai Team <notifications@leadprospecting.ai>',
      to: emails,
      subject: processedSubject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 10px;">
            <h2 style="color: #059669; margin-bottom: 20px;">Team Notification</h2>
            <div style="background-color: #ffffff; padding: 15px; border-radius: 5px; margin: 20px 0;">
              ${processedMessage.replace(/\n/g, '<br>')}
            </div>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
            <p style="font-size: 12px; color: #6b7280;">
              This is an automated notification from LPai.
            </p>
          </div>
        </div>
      `
    });
    
    console.log('[Internal Notification] Email sent successfully:', emailResponse.id);
    return { 
      sent: true, 
      recipients: emails.length, 
      emailId: emailResponse.id,
      message: processedMessage 
    };
    
  } catch (error) {
    console.error('[Internal Notification] Error:', error);
    return { error: error.message };
  }
}

// Location Actions
async function executeEnableTracking(action: any, context: any, db: Db) {
  const { trackingType = 'location', enabled = true } = action.config;
  
  if (!context.contact?._id) {
    return { error: 'Contact required for tracking' };
  }
  
  await db.collection('contacts').updateOne(
    { _id: context.contact._id },
    { 
      $set: { 
        [`tracking.${trackingType}`]: enabled,
        lastModified: new Date()
      }
    }
  );
  
  return { trackingEnabled: enabled, type: trackingType };
}

async function executeCheckWeather(action: any, context: any, db: Db) {
  const { location, units = 'imperial' } = action.config;
  
  if (!location) return { error: 'No location specified for weather check' };
  
  try {
    const weatherResponse = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&units=${units}&appid=${process.env.OPENWEATHER_API_KEY}`
    );
    
    if (weatherResponse.status === 200) {
      const weatherData = weatherResponse.data;
      
      // Store weather data for potential use in other actions
      await db.collection('weather_cache').insertOne({
        location,
        data: weatherData,
        cachedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
      });
      
      return { 
        checked: true, 
        location,
        temperature: weatherData.main?.temp,
        conditions: weatherData.weather?.[0]?.description
      };
    } else {
      return { error: 'Weather API request failed' };
    }
  } catch (error) {
    return { error: 'Weather check failed', details: error instanceof Error ? error.message : String(error) };
  }
}

// Advanced Automation Actions
async function executeCreateFollowUp(action: any, context: any, db: Db) {
  const { type, daysFromNow = 3, message, priority = 'normal' } = action.config;
  
  if (!context.contact?._id) {
    return { error: 'Contact required for follow-up creation' };
  }
  
  const followUp = {
    type: type, // 'call', 'email', 'task', 'visit'
    contactId: context.contact._id,
    projectId: context.project?._id,
    assignedTo: context.contact?.assignedTo || context.project?.assignedUserId,
    dueDate: new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000),
    message: replaceVariablesInMessage(message, context),
    priority,
    status: 'pending',
    createdBy: 'automation',
    createdAt: new Date()
  };
  
  const result = await db.collection('follow_ups').insertOne(followUp);
  
  // Send push notification to assigned user
  if (followUp.assignedTo) {
    try {
      const user = await db.collection('users').findOne({ 
        $or: [
          { _id: new ObjectId(followUp.assignedTo) },
          { ghlUserId: followUp.assignedTo }
        ]
      });
      
      if (user?.oneSignalIds?.length > 0) {
        const playerIds = user.oneSignalIds.map((item: any) => 
         typeof item === 'string' ? item : item.playerId
       ).filter(Boolean);
                 if (playerIds.length > 0) {
           await axios.post('https://onesignal.com/api/v1/notifications', {
             app_id: process.env.ONESIGNAL_APP_ID,
             include_player_ids: playerIds,
             headings: { en: `Follow-up in ${daysFromNow} days` },
             contents: { en: followUp.message },
                            data: { 
                 type: 'follow-up', 
                 contactId: context.contact._id,
                 followUpId: result.insertedId
               }
             }, {
               headers: {
                 'Content-Type': 'application/json',
                 'Authorization': `Basic ${process.env.ONESIGNAL_REST_API_KEY}`
               }
             });
         }
      }
    } catch (error) {
      console.error('Failed to send follow-up notification:', error);
    }
  }
  
  return { created: true, followUpId: result.insertedId, dueDate: followUp.dueDate };
}

async function executeDuplicateCheck(action: any, context: any, db: Db) {
  const { checkField = 'email', actionIfDuplicate = 'skip', mergeStrategy = 'keep-existing' } = action.config;
  
  if (!context.contact?._id || !context.contact?.[checkField]) {
    return { error: 'Contact and check field required for duplicate check' };
  }
  
  const existing = await db.collection('contacts').findOne({
    locationId: context.location.locationId,
    [checkField]: context.contact[checkField],
    _id: { $ne: context.contact._id }
  });
  
  if (existing) {
    if (actionIfDuplicate === 'merge') {
      // Merge contacts based on strategy
      let mergedData = {};
      
      if (mergeStrategy === 'keep-existing') {
        mergedData = {
          ...existing,
          mergedFrom: context.contact._id,
          mergedAt: new Date(),
          lastModified: new Date()
        };
      } else if (mergeStrategy === 'overwrite-existing') {
        mergedData = {
          ...context.contact,
          mergedFrom: existing._id,
          mergedAt: new Date(),
          lastModified: new Date()
        };
      }
      
      // Update the existing contact
      await db.collection('contacts').updateOne(
        { _id: existing._id },
        { $set: mergedData }
      );
      
      // Mark the new contact as merged
      await db.collection('contacts').updateOne(
        { _id: context.contact._id },
        { 
          $set: { 
            status: 'merged',
            mergedInto: existing._id,
            mergedAt: new Date()
          }
        }
      );
      
      return { 
        isDuplicate: true, 
        action: 'merged', 
        existingId: existing._id,
        strategy: mergeStrategy
      };
    } else if (actionIfDuplicate === 'skip') {
      return { isDuplicate: true, action: 'skipped', existingId: existing._id };
    } else if (actionIfDuplicate === 'update-existing') {
      // Update existing contact with new data
      await db.collection('contacts').updateOne(
        { _id: existing._id },
        { 
          $set: { 
            ...context.contact,
            lastModified: new Date(),
            updatedBy: 'automation'
          }
        }
      );
      
      return { isDuplicate: true, action: 'updated', existingId: existing._id };
    }
  }
  
  return { isDuplicate: false };
}

// Assignment Actions
async function executeAssignUser(action: any, context: any, db: Db) {
  const { userId, assignTo } = action.config;
  
  if (!userId || !assignTo) {
    return { error: 'Missing userId or assignTo configuration' };
  }
  
  // Find the user to assign
  const user = await db.collection('users').findOne({ 
    $or: [
      { _id: new ObjectId(userId) },
      { ghlUserId: userId }
    ]
  });
  
  if (!user) {
    return { error: 'User not found' };
  }
  
  // Update contact assignment
  if (context.contact?._id) {
    await db.collection('contacts').updateOne(
      { _id: context.contact._id },
      { $set: { assignedTo: user.ghlUserId } }
    );
  }
  
  // Update project assignment
  if (context.project?._id) {
    await db.collection('projects').updateOne(
      { _id: context.project._id },
      { $set: { assignedUserId: user.ghlUserId } }
    );
  }
  
  return { assigned: true, userId: user.ghlUserId, userName: user.name };
}

async function executeRoundRobinAssign(action: any, context: any, db: Db) {
  const { role = 'consultant' } = action.config;
  
  // Get all active users with role
  const users = await db.collection('users').find({
    locationId: context.location.locationId,
    role,
    isActive: true
  }).toArray();
  
  if (users.length === 0) return { error: 'No users found for round robin' };
  
  // Get last assignment index
  const tracker = await db.collection('assignment_tracking').findOne({
    locationId: context.location.locationId,
    type: 'round-robin',
    role
  });
  
  const nextIndex = ((tracker?.lastIndex || -1) + 1) % users.length;
  const assignedUser = users[nextIndex];
  
  // Update tracker
  await db.collection('assignment_tracking').updateOne(
    { locationId: context.location.locationId, type: 'round-robin', role },
    { 
      $set: { 
        lastIndex: nextIndex, 
        lastAssigned: new Date(),
        lastUserId: assignedUser._id
      }
    },
    { upsert: true }
  );
  
  // Update contact
  if (context.contact?._id) {
    await db.collection('contacts').updateOne(
      { _id: context.contact._id },
      { $set: { assignedTo: assignedUser.ghlUserId } }
    );
  }
  
  // Update project
  if (context.project?._id) {
    await db.collection('projects').updateOne(
      { _id: context.project._id },
      { $set: { assignedUserId: assignedUser.ghlUserId } }
    );
  }
  
  return { assigned: true, userId: assignedUser.ghlUserId, userName: assignedUser.name };
}

async function executeUnassign(action: any, context: any, db: Db) {
  // Remove assignment from contact
  if (context.contact?._id) {
    await db.collection('contacts').updateOne(
      { _id: context.contact._id },
      { $unset: { assignedTo: "" } }
    );
  }
  
  // Remove assignment from project
  if (context.project?._id) {
    await db.collection('projects').updateOne(
      { _id: context.project._id },
      { $unset: { assignedUserId: "" } }
    );
  }
  
  return { unassigned: true };
}


/**
 * Replace variables in messages using context data
 */
function replaceVariablesInMessage(message: string, context: any): string {
  if (!message) return message;
  
  // Log for debugging
  console.log('🔍 Variable replacement debug:');
  console.log('  - Original message:', message);
  console.log('  - Context keys:', Object.keys(context));
  console.log('  - Context structure:', {
    contact: context.contact ? {
      id: context.contact._id,
      name: context.contact.name,
      firstName: context.contact.firstName,
      lastName: context.contact.lastName,
      fullName: context.contact.fullName,
      email: context.contact.email
    } : null,
    project: context.project ? {
      id: context.project._id,
      title: context.project.title,
      name: context.project.name
    } : null,
    event: context.event ? {
      type: context.event.type,
      data: context.event.data
    } : null
  });
  
  return message.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const keys = path.trim().split('.');
    let value = context;
    
    // Handle special cases for common variable patterns with better fallbacks
    if (path === 'contact.name' || path === 'contact.fullName') {
      // Try multiple possible contact name fields with better fallbacks
      value = context.contact?.fullName || 
               context.contact?.name || 
               `${context.contact?.firstName || ''} ${context.contact?.lastName || ''}`.trim() ||
               context.contact?.firstName ||
               context.contact?.lastName ||
               context.contact?.email?.split('@')[0] || // Use email prefix as fallback
               'Contact';
    } else if (path === 'contact.firstName') {
      value = context.contact?.firstName || 
              context.contact?.name?.split(' ')[0] || 
              context.contact?.email?.split('@')[0] || 
              'Contact';
    } else if (path === 'contact.lastName') {
      value = context.contact?.lastName || 
              context.contact?.name?.split(' ').slice(1).join(' ') || 
              '';
    } else if (path === 'contact.email') {
      value = context.contact?.email || 'No email';
    } else if (path === 'project.title' || path === 'project.name') {
      value = context.project?.title || 
              context.project?.name || 
              context.project?.description?.substring(0, 50) || 
              'Project';
    } else if (path === 'company.name') {
      value = context.location?.name || 
              context.location?.companyName || 
              context.location?.businessName || 
              'Company';
    } else if (path === 'user.name' || path === 'user.fullName') {
      value = context.user?.fullName || 
              context.user?.name || 
              context.user?.firstName || 
              context.user?.email?.split('@')[0] || 
              'User';
    } else if (path === 'user.firstName') {
      // Enhanced user lookup with multiple fallbacks
      value = context.user?.firstName || 
              context.user?.name?.split(' ')[0] ||
              context.smsUser?.firstName ||  // Check smsUser if available
              context.emailUser?.firstName || // Check emailUser if available
              'Team Member';
    } else if (path === 'user.lastName') {
      value = context.user?.lastName || 
              context.user?.name?.split(' ').slice(1).join(' ') ||
              context.smsUser?.lastName ||
              context.emailUser?.lastName ||
              '';
    // ADD THIS NEW SECTION:
    } else if (path === 'reschedule.link' || path === 'appointment.rescheduleLink') {
      // Build reschedule link
      const calendarId = context.appointment?.calendarId || context.event?.calendarId;
      const ghlAppointmentId = context.appointment?.ghlAppointmentId || context.appointment?.appointmentId;
      
      if (calendarId && ghlAppointmentId) {
        value = `https://updates.leadprospecting.ai/widget/booking/${calendarId}?event_id=${ghlAppointmentId}`;
        console.log('✅ Generated reschedule link:', value);
      } else {
        console.warn('⚠️ Missing calendarId or ghlAppointmentId for reschedule link');
        value = 'reschedule link unavailable';
      }
    } else if (path === 'user.phone') {
      value = context.user?.phone || 
              context.smsUser?.phone ||
              context.emailUser?.phone ||
              '';
    } else if (path === 'event.type') {
      value = context.event?.type || 'Event';
    } else {
      // Standard path resolution with better error handling
      for (const key of keys) {
        if (value === null || value === undefined) {
          console.log(`    ⚠️ Path not found: ${path} (stopped at ${key})`);
          return match; // Keep original if path not found
        }
        value = value[key];
      }
    }
    
    // Ensure we have a string value
    const finalValue = String(value || '');
    console.log(`    ✅ Replaced ${match} with "${finalValue}"`);
    return finalValue;
  });
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: any, path: string): any {
  console.log(`🔍 [getNestedValue] Looking for path: "${path}" in object keys:`, Object.keys(obj));
  
  const result = path.split('.').reduce((current, key) => {
    console.log(`  - Checking key "${key}" in:`, current ? Object.keys(current) : 'null/undefined');
    return current?.[key];
  }, obj);
  
  console.log(`🔍 [getNestedValue] Final result for "${path}":`, result, typeof result);
  return result;
}

// Control Flow Actions
async function executeConditional(action: any, context: any, db: Db) {
  const { condition, thenActions = [], elseActions = [] } = action.config;
  
  // Check condition (e.g., "if quote value > 5000")
  let conditionMet = false;
  const fieldValue = context[condition.entity]?.[condition.field];
  
  switch (condition.operator) {
    case 'greater-than':
      conditionMet = Number(fieldValue) > Number(condition.value);
      break;
    case 'less-than':
      conditionMet = Number(fieldValue) < Number(condition.value);
      break;
    case 'equals':
      conditionMet = fieldValue == condition.value;
      break;
    case 'not-equals':
      conditionMet = fieldValue != condition.value;
      break;
    case 'contains':
      conditionMet = String(fieldValue).includes(condition.value);
      break;
    case 'exists':
      conditionMet = fieldValue !== undefined && fieldValue !== null;
      break;
    case 'empty':
      conditionMet = !fieldValue || fieldValue === '' || (Array.isArray(fieldValue) && fieldValue.length === 0);
      break;
  }
  
  // Execute appropriate actions
  const actionsToRun = conditionMet ? thenActions : elseActions;
  const results = [];
  
  for (const subAction of actionsToRun) {
    try {
      const handler = ACTION_HANDLERS[subAction.type];
      if (handler) {
        const result = await handler(subAction, context, db);
        results.push(result);
      }
    } catch (error) {
      console.error(`Conditional action execution failed:`, error);
      results.push({ error: error instanceof Error ? error.message : String(error) });
    }
  }
  
  return { conditionMet, executed: results.length, results };
}

async function executeWait(action: any, context: any, db: Db) {
  const { delayMinutes = 60 } = action.config;
  
  // Create a scheduled queue entry
  await db.collection('automation_queue').insertOne({
    ruleId: context.rule._id,
    trigger: {
      type: 'delayed-action',
      originalTrigger: context.event.type,
      locationId: context.location.locationId,
      data: context.event
    },
    scheduledFor: new Date(Date.now() + delayMinutes * 60000),
    status: 'scheduled',
    createdAt: new Date()
  });
  
  return { scheduled: true, executeAt: new Date(Date.now() + delayMinutes * 60000) };
}

async function executeKeywordRouter(action: any, context: any, db: Db) {
  const { keywordField, routes = [] } = action.config;
  
  // Get the text to analyze
  const text = context[keywordField] || context.contact?.[keywordField] || '';
  
  // Find matching route
  const matchingRoute = routes.find(route => {
    const keywords = Array.isArray(route.keywords) ? route.keywords : [route.keywords];
    return keywords.some(keyword => 
      text.toLowerCase().includes(keyword.toLowerCase())
    );
  });
  
  if (matchingRoute && matchingRoute.actions) {
    // Execute the matching route's actions
    const results = [];
    for (const subAction of matchingRoute.actions) {
      try {
        const handler = ACTION_HANDLERS[subAction.type];
        if (handler) {
          const result = await handler(subAction, context, db);
          results.push(result);
        }
      } catch (error) {
        console.error(`Keyword router action execution failed:`, error);
        results.push({ error: error instanceof Error ? error.message : String(error) });
      }
    }
    
    return { routed: true, route: matchingRoute.name, executed: results.length, results };
  }
  
  return { routed: false, message: 'No matching route found' };
}

// Test function for variable replacement (can be removed in production)
export function testVariableReplacement() {
  const testContext = {
    contact: {
      _id: 'test-contact-id',
      name: 'John Doe',
      firstName: 'John',
      lastName: 'Doe',
      fullName: 'John Doe',
      email: 'john.doe@example.com'
    },
    project: {
      _id: 'test-project-id',
      title: 'Website Redesign',
      name: 'Website Redesign',
      description: 'Complete overhaul of company website'
    },
    location: {
      name: 'Acme Corp',
      companyName: 'Acme Corporation',
      businessName: 'Acme Corp'
    },
    user: {
      name: 'Jane Smith',
      fullName: 'Jane Smith',
      firstName: 'Jane',
      email: 'jane.smith@example.com'
    },
    event: {
      type: 'contact-created',
      data: { source: 'web' }
    }
  };

  const testMessages = [
    'Hello {{contact.name}}, welcome to {{company.name}}!',
    'New project: {{project.title}} for {{contact.firstName}}',
    'Event: {{event.type}} - {{contact.email}}',
    'User {{user.name}} assigned to {{project.name}}',
    '{{contact.fullName}} - {{project.title}} - {{company.name}}'
  ];

  console.log('🧪 Testing variable replacement:');
  testMessages.forEach(message => {
    const result = replaceVariablesInMessage(message, testContext);
    console.log(`  "${message}" → "${result}"`);
  });

  return 'Variable replacement test completed';
}