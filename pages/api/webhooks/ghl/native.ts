// pages/api/webhooks/ghl/native.ts
// Updated: 2025-06-24 - Added direct processing for messages
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { analyzeWebhook, isSystemHealthy } from '../../../../src/utils/webhooks/router';
import { QueueManager } from '../../../../src/utils/webhooks/queueManager';
import { processMessageDirect } from '../../../../src/utils/webhooks/directProcessor';
import Ably from 'ably';
import { eventBus } from '../../../../src/services/eventBus';

// GHL Public Key for webhook verification
const GHL_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAokvo/r9tVgcfZ5DysOSC
Frm602qYV0MaAiNnX9O8KxMbiyRKWeL9JpCpVpt4XHIcBOK4u3cLSqJGOLaPuXw6
dO0t6Q/ZVdAV5Phz+ZtzPL16iCGeK9po6D6JHBpbi989mmzMryUnQJezlYJ3DVfB
csedpinheNnyYeFXolrJvcsjDtfAeRx5ByHQmTnSdFUzuAnC9/GepgLT9SM4nCpv
uxmZMxrJt5Rw+VUaQ9B8JSvbMPpez4peKaJPZHBbU3OdeCVx5klVXXZQGNHOs8gF
3kvoV5rTnXV0IknLBXlcKKAQLZcY/Q9rG6Ifi9c+5vqlvHPCUJFT5XUGG5RKgOKU
J062fRtN+rLYZUV+BjafxQauvC8wSWeYja63VSUruvmNj8xkx2zE/Juc+yjLjTXp
IocmaiFeAO6fUtNjDeFVkhf5LNb59vECyrHD2SQIrhgXpO4Q3dVNA5rw576PwTzN
h/AMfHKIjE4xQA1SZuYJmNnmVZLIZBlQAF9Ntd03rfadZ+yDiOXCCs9FkHibELhC
HULgCsnuDJHcrGNd5/Ddm5hxGQ0ASitgHeMZ0kcIOwKDOzOU53lDza6/Y09T7sYJ
PQe7z0cvj7aE4B+Ax1ZoZGPzpJlZtGXCsu9aTEGEnKzmsFqwcSsnw3JB31IGKAyk
T1hhTiaCeIY/OwwwNUY2yvcCAwEAAQ==
-----END PUBLIC KEY-----`;

function verifyWebhookSignature(payload: string, signature: string): boolean {
  try {
    const verifier = crypto.createVerify('SHA256');
    verifier.update(payload);
    verifier.end();
    return verifier.verify(GHL_PUBLIC_KEY, signature, 'base64');
  } catch (error) {
    console.error('[Webhook Verification] Error:', error);
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const receivedAt = new Date();
  
  // Get signature from headers
  const signature = req.headers['x-wh-signature'] as string;
  
  if (!signature) {
    console.log('[Native Webhook] No signature provided');
    return res.status(401).json({ error: 'No signature' });
  }

  // Verify signature
  const payload = JSON.stringify(req.body);
  if (!verifyWebhookSignature(payload, signature)) {
    console.log('[Native Webhook] Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Generate webhook ID
  const webhookId = req.body.webhookId || new ObjectId().toString();
  
  // Log webhook type
  const eventType = req.body.type;
  console.log(`[Native Webhook ${webhookId}] Received: ${eventType}`);

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Initialize Ably for real-time updates
    const ably = process.env.ABLY_API_KEY ? new Ably.Rest(process.env.ABLY_API_KEY) : null;

    // Check timestamp to prevent replay attacks (within 5 minutes)
    if (req.body.timestamp) {
      const webhookTime = new Date(req.body.timestamp).getTime();
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;
      
      if (Math.abs(now - webhookTime) > fiveMinutes) {
        console.error(`[Native Webhook ${webhookId}] Timestamp too old, possible replay attack`);
        return res.status(200).json({ success: false, error: 'Timestamp expired' });
      }
    }

    // Check for duplicate outbound messages BEFORE any processing
    if (eventType === 'OutboundMessage' && req.body.messageId) {
      const existingMessage = await db.collection('messages').findOne({
        ghlMessageId: req.body.messageId
      });
      
      if (existingMessage) {
        console.log(`[Native Webhook ${webhookId}] Duplicate outbound message ${req.body.messageId}, skipping`);
        return res.status(200).json({ 
          success: true, 
          skipped: true, 
          reason: 'Duplicate outbound message' 
        });
      }
    }

    // Parse the webhook data from the body
    const webhookData = req.body;
    
    // Handle nested webhook structure for native webhooks
    let parsedPayload;
    if (webhookData.webhookPayload) {
      // Native webhook structure
      parsedPayload = {
        ...webhookData.webhookPayload,
        type: webhookData.type,
        locationId: webhookData.locationId || webhookData.webhookPayload.locationId,
        companyId: webhookData.companyId || webhookData.webhookPayload.companyId,
        timestamp: webhookData.timestamp || webhookData.webhookPayload.timestamp || new Date().toISOString(),
        webhookId: webhookData.webhookId,
        // Add the entire webhook payload as nested data in case we need it
        webhookPayload: webhookData.webhookPayload
      };
    } else {
      // Direct webhook structure
      parsedPayload = webhookData;
    }

    // Check system health
    const systemHealthy = await isSystemHealthy(db);
    if (!systemHealthy) {
      console.warn(`[Native Webhook ${webhookId}] System unhealthy, queuing with lower priority`);
    }

    // NEW: Fast-track message processing
    const { type } = parsedPayload;
    
    if (type === 'InboundMessage' || type === 'OutboundMessage') {
      console.log(`[Native Webhook ${webhookId}] Attempting direct processing for ${type}`);
      
      try {
        // Extract the actual message data for direct processor
        let directPayload;
        
        if (parsedPayload.webhookPayload) {
          // Native webhook format - unwrap it
          directPayload = {
            type,
            locationId: parsedPayload.locationId || parsedPayload.webhookPayload.locationId,
            timestamp: parsedPayload.timestamp || parsedPayload.webhookPayload.timestamp,
            ...parsedPayload.webhookPayload  // Spread the actual webhook data
          };
        } else {
          // Already in direct format (from req.body)
          directPayload = webhookData;
        }
        
        // Log the payload structure for debugging
        console.log(`[Native Webhook ${webhookId}] Direct payload keys:`, Object.keys(directPayload));
        
        // Process directly for instant updates
        await processMessageDirect(db, webhookId, directPayload);
        
        console.log(`[Native Webhook ${webhookId}] Direct processing successful for ${type}`);
        
        // Still queue as backup but mark as already processed
        const queueManager = new QueueManager(db);
        await queueManager.addToQueue({
          webhookId,
          type,
          payload: parsedPayload,
          queueType: 'messages',
          priority: 2,
          receivedAt,
          metadata: { 
            directProcessed: true,
            directProcessedAt: new Date()
          }
        });
        
        // Return early - we're done!
        return res.status(200).json({ 
          success: true, 
          processed: 'direct',
          webhookId 
        });
        
      } catch (directError: unknown) {
        console.error(`[Native Webhook ${webhookId}] Direct processing failed for ${type}:`, directError instanceof Error ? directError.message : String(directError));
        // Fall through to normal queue processing
      }
    }

    // Analyze webhook for routing
    const routingResult = analyzeWebhook(parsedPayload);
    console.log(`[Native Webhook ${webhookId}] Routing: queue=${routingResult.queueType}, priority=${routingResult.priority}`);

    // Queue for processing
    const queueManager = new QueueManager(db);
    const queueItem = await queueManager.addToQueue({
      webhookId,
      type: parsedPayload.type,
      payload: parsedPayload,
      queueType: routingResult.queueType,
      priority: routingResult.priority,
      receivedAt,
      metadata: {
        source: 'native',
        systemHealthy,
        routerAnalysis: routingResult
      }
    });

    console.log(`[Native Webhook ${webhookId}] Queued successfully as ${queueItem._id}`);

    // Store webhook for discovery/monitoring
    await db.collection('webhook_discovery').insertOne({
      _id: new ObjectId(),
      webhookId,
      type: parsedPayload.type,
      locationId: parsedPayload.locationId,
      companyId: parsedPayload.companyId,
      receivedAt,
      queuedAt: new Date(),
      queueType: routingResult.queueType,
      priority: routingResult.priority,
      structure: {
        hasWebhookPayload: !!webhookData.webhookPayload,
        topLevelKeys: Object.keys(webhookData),
        payloadKeys: webhookData.webhookPayload ? Object.keys(webhookData.webhookPayload) : [],
        nestedDepth: webhookData.webhookPayload ? 2 : 1
      },
      ttl: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    });

    // Trigger automations based on webhook event type
    try {
      // Only process automation triggers after successful webhook processing
      const automationTriggers = [];

      // Map GHL webhook events to automation triggers
      switch (parsedPayload.type) {
        case 'OpportunityStageUpdate':
          if (parsedPayload.pipelineStageId) {
            automationTriggers.push({
              type: 'stage-entered',
              locationId: parsedPayload.locationId,
              contactId: parsedPayload.contactId,
              projectId: parsedPayload.id,
              stageId: parsedPayload.pipelineStageId,
              assignedUserId: parsedPayload.assignedTo,
              data: parsedPayload
            });
          }
          
          // Emit automation event for stage change
          try {
            eventBus.emit('project.stage.changed', {
              data: {
                locationId: parsedPayload.locationId,
                projectId: parsedPayload.id,
                newStage: parsedPayload.pipelineStageId,
                oldStage: parsedPayload.pipelineStageId // This will be updated when we get the current project
              }
            });
            console.log('✅ Emitted stage-entered automation event');
          } catch (error) {
            console.error('Failed to emit stage-entered:', error);
          }
          break;

        case 'OpportunityUpdate':
          // Check if stage changed
          if (parsedPayload.pipelineStageId) {
            // Get the current project to see if stage actually changed
            const currentProject = await db.collection('projects').findOne({ 
              ghlOpportunityId: parsedPayload.id 
            });
            
            // Only trigger if stage actually changed
            if (currentProject && currentProject.pipelineStageId !== parsedPayload.pipelineStageId) {
              automationTriggers.push({
                type: 'stage-entered',
                locationId: parsedPayload.locationId,
                contactId: parsedPayload.contactId,
                projectId: parsedPayload.id,
                stageId: parsedPayload.pipelineStageId,
                pipelineId: parsedPayload.pipelineId,
                assignedUserId: parsedPayload.assignedTo,
                previousStageId: currentProject.pipelineStageId,
                data: parsedPayload
              });
            }
          }
          break;

        case 'ContactCreate':
          if (parsedPayload.customFields) {
            automationTriggers.push({
              type: 'field-change',
              locationId: parsedPayload.locationId,
              contactId: parsedPayload.id,
              data: parsedPayload
            });
          }
          
          // Emit automation event for contact created
          try {
            eventBus.emitContactCreated({
              ...parsedPayload,
              locationId: parsedPayload.locationId
            });
            console.log('✅ Emitted contact-created automation event');
          } catch (error) {
            console.error('Failed to emit contact-created:', error);
          }
          break;
          
        case 'ContactUpdate':
          if (parsedPayload.customFields) {
            automationTriggers.push({
              type: 'field-change',
              locationId: parsedPayload.locationId,
              contactId: parsedPayload.id,
              data: parsedPayload
            });
          }
          
          // Emit automation event for contact updated
          try {
            eventBus.emitContactUpdated({
              ...parsedPayload,
              locationId: parsedPayload.locationId
            }, {});
            console.log('✅ Emitted contact-updated automation event');
          } catch (error) {
            console.error('Failed to emit contact-updated:', error);
          }
          break;

        case 'AppointmentCreate':
          // Check for duplicate appointment triggers in the last 5 minutes
          const existingAppointmentTrigger = await db.collection('automation_queue').findOne({
            'trigger.data.appointmentId': parsedPayload.id,
            'trigger.type': { $in: ['appointment-scheduled', 'job:scheduled'] },
            createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // Last 5 minutes
          });

          if (existingAppointmentTrigger) {
            console.log(`Duplicate appointment trigger detected for ${parsedPayload.id}, skipping`);
            break;
          }

          automationTriggers.push({
            type: 'job:scheduled',
            locationId: parsedPayload.locationId,
            contactId: parsedPayload.contactId,
            appointmentId: parsedPayload.id,
            data: parsedPayload
          });
          break;

        case 'AppointmentUpdate':
          if (parsedPayload.status === 'cancelled') {
            // Check for duplicate appointment cancelled triggers in the last 5 minutes
            const existingCancelledTrigger = await db.collection('automation_queue').findOne({
              'trigger.data.appointmentId': parsedPayload.id,
              'trigger.type': 'appointment-cancelled',
              createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // Last 5 minutes
            });

            if (existingCancelledTrigger) {
              console.log(`Duplicate appointment cancelled trigger detected for ${parsedPayload.id}, skipping`);
            } else {
              automationTriggers.push({
                type: 'appointment-cancelled',
                locationId: parsedPayload.locationId,
                contactId: parsedPayload.contactId,
                appointmentId: parsedPayload.id,
                data: parsedPayload
              });
            }
          } else if (parsedPayload.status === 'completed') {
            // Check for duplicate appointment completed triggers in the last 5 minutes
            const existingCompletedTrigger = await db.collection('automation_queue').findOne({
              'trigger.data.appointmentId': parsedPayload.id,
              'trigger.type': 'appointment-completed',
              createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // Last 5 minutes
            });

            if (existingCompletedTrigger) {
              console.log(`Duplicate appointment completed trigger detected for ${parsedPayload.id}, skipping`);
            } else {
              automationTriggers.push({
                type: 'appointment-completed',
                locationId: parsedPayload.locationId,
                contactId: parsedPayload.contactId,
                appointmentId: parsedPayload.id,
                data: parsedPayload
              });
            }
          }
          break;

        case 'InvoicePaid':
          // Determine if this is a deposit payment
          const paymentType = parsedPayload.description?.toLowerCase().includes('deposit') || 
                             parsedPayload.paymentType === 'deposit' ? 'deposit' : 'payment';
          
          automationTriggers.push({
            type: 'payment-received',
            locationId: parsedPayload.locationId,
            contactId: parsedPayload.contactId,
            invoiceId: parsedPayload.id,
            amount: parsedPayload.amount,
            paymentType: paymentType,
            data: {
              ...parsedPayload,
              payment: {
                type: paymentType,
                amount: parsedPayload.amount,
                invoiceId: parsedPayload.id
              }
            }
          });
          break;

        case 'SMSInbound':
          automationTriggers.push({
            type: 'customer:reply:sms',
            locationId: parsedPayload.locationId,
            contactId: parsedPayload.contactId,
            message: parsedPayload.body,
            data: parsedPayload
          });
          break;

        case 'OpportunityCreate':
          // Check if project already exists (created by app)
          const existingProject = await db.collection('projects').findOne({
            ghlOpportunityId: parsedPayload.id,
            locationId: parsedPayload.locationId
          });
          
          if (existingProject) {
            console.log('Project already exists, skipping automation trigger');
            break; // Don't trigger automations for already-existing projects
          }
          
          // Only trigger automations if this is a new project from GHL
          automationTriggers.push({
            type: 'project-created',
            locationId: parsedPayload.locationId,
            contactId: parsedPayload.contactId,
            projectId: parsedPayload.id,
            stageId: parsedPayload.pipelineStageId,
            pipelineId: parsedPayload.pipelineId,
            data: parsedPayload
          });
          break;

        case 'ContactAssignedToUpdate':
          automationTriggers.push({
            type: 'contact-assigned',
            locationId: parsedPayload.locationId,
            contactId: parsedPayload.id,
            assignedTo: parsedPayload.assignedTo,
            data: {
              contact: {
                _id: parsedPayload.id,
                assignedTo: parsedPayload.assignedTo
              }
            }
          });
          break;

        case 'InvoiceSent':
          automationTriggers.push({
                            type: 'invoice-sent',
            locationId: parsedPayload.locationId,
            contactId: parsedPayload.contactId,
            invoiceId: parsedPayload.id,
            amount: parsedPayload.amount,
            data: parsedPayload
          });
          break;

        case 'TaskCreate':
          automationTriggers.push({
            type: 'task:created',
            locationId: parsedPayload.locationId,
            contactId: parsedPayload.contactId,
            taskId: parsedPayload.id,
            assignedTo: parsedPayload.assignedTo,
            data: parsedPayload
          });
          break;

                 case 'TaskComplete':
           automationTriggers.push({
             type: 'task:completed',
             locationId: parsedPayload.locationId,
             contactId: parsedPayload.contactId,
             taskId: parsedPayload.id,
             data: parsedPayload
           });
           break;

                 case 'QuoteSigned':
          automationTriggers.push({
            type: 'quote-signed',
            locationId: parsedPayload.locationId,
            contactId: parsedPayload.contactId,
            quoteId: parsedPayload.id,
            projectId: parsedPayload.opportunityId || parsedPayload.projectId,
            amount: parsedPayload.amount,
            data: {
              quote: {
                _id: parsedPayload.id,
                projectId: parsedPayload.opportunityId || parsedPayload.projectId,
                total: parsedPayload.amount,
                depositAmount: parsedPayload.depositAmount || 0
              },
              project: {
                _id: parsedPayload.opportunityId || parsedPayload.projectId,
                pipelineId: parsedPayload.pipelineId
              },
              contact: {
                _id: parsedPayload.contactId
              }
            }
          });
          break;

         case 'QuoteViewed':
           automationTriggers.push({
             type: 'quote-viewed',
             locationId: parsedPayload.locationId,
             contactId: parsedPayload.contactId,
             quoteId: parsedPayload.id,
             data: parsedPayload
           });
           break;
           
         case 'FormSubmitted':
           // Process form submission
           const formData = {
             formId: parsedPayload.formId,
             formName: parsedPayload.formName,
             contactId: parsedPayload.contactId,
             locationId: parsedPayload.locationId,
             submissionData: parsedPayload.submission_data,
             submittedAt: new Date()
           };
           
           // Store form submission
           await db.collection('form_submissions').insertOne(formData);
           
           // Emit automation event
           try {
             const { AutomationEventListener } = await import('../../../../src/services/automationEventListener');
             const automationEventListener = new AutomationEventListener(db);
             await automationEventListener.emitFormSubmitted(formData);
             console.log('✅ Emitted form-submitted automation event');
           } catch (error) {
             console.error('Failed to emit form-submitted:', error);
           }
           break;
           
         case 'EmailOpened':
           // Emit automation event for email opened
           try {
             const { AutomationEventListener } = await import('../../../../src/services/automationEventListener');
             const automationEventListener = new AutomationEventListener(db);
             
             // Find contact by email
             const contact = await db.collection('contacts').findOne({ 
               email: parsedPayload.contactEmail,
               locationId: parsedPayload.locationId 
             });
             
             if (contact) {
               await automationEventListener.emitEmailOpened({
                 contactId: contact._id.toString(),
                 locationId: parsedPayload.locationId,
                 emailId: parsedPayload.emailMessageId,
                 contact: contact
               });
               console.log('✅ Emitted email-opened automation event');
             }
           } catch (error) {
             console.error('Failed to emit email-opened:', error);
           }
           break;
      }

               // Process automation triggers asynchronously (don't block webhook response)
       if (automationTriggers.length > 0) {
         // Insert automation triggers into the automation_queue collection
         for (const trigger of automationTriggers) {
           let entityType = 'project'; // Default for project-related triggers
           let project = null;
           let contact = null;
           let appointment = null;
           let invoice = null;
           
           // Determine entity type and fetch appropriate data based on trigger type
                       if (trigger.type === 'stage-entered' || trigger.type === 'enter:stage' || trigger.type === 'project-created') {
             // Project-related triggers
             entityType = 'project';
             project = await db.collection('projects').findOne({ 
               ghlOpportunityId: parsedPayload.id 
             });
                       } else if (trigger.type === 'field-change' || trigger.type === 'contact-assigned') {
             // Contact-related triggers
             entityType = 'contact';
             // Only lookup contact for contact-related triggers
             if (parsedPayload.contactId) {
               contact = await db.collection('contacts').findOne({ 
                 ghlContactId: parsedPayload.contactId 
               });
             }
                       } else if (trigger.type === 'job:scheduled' || trigger.type === 'appointment-cancelled' || trigger.type === 'appointment-completed') {
             // Appointment-related triggers
             entityType = 'appointment';
             appointment = await db.collection('appointments').findOne({ 
               ghlAppointmentId: parsedPayload.id 
             });
             // Only lookup contact if needed for appointment triggers
             if (parsedPayload.contactId) {
               contact = await db.collection('contacts').findOne({ 
                 ghlContactId: parsedPayload.contactId 
               });
             }
                       } else if (trigger.type === 'payment-received' || trigger.type === 'invoice-sent') {
             // Invoice-related triggers
             entityType = 'invoice';
             invoice = await db.collection('invoices').findOne({ 
               ghlInvoiceId: parsedPayload.id 
             });
             // Only lookup contact if needed for invoice triggers
             if (parsedPayload.contactId) {
               contact = await db.collection('contacts').findOne({ 
                 ghlContactId: parsedPayload.contactId 
               });
             }
           } else if (trigger.type === 'task-created' || trigger.type === 'task-completed') {
             // Task-related triggers
             entityType = 'task';
             // Only lookup contact if needed for task triggers
             if (parsedPayload.contactId) {
               contact = await db.collection('contacts').findOne({ 
                 ghlContactId: parsedPayload.contactId 
               });
             }
                       } else if (trigger.type === 'quote-signed' || trigger.type === 'quote-viewed') {
              // Quote-related triggers
              entityType = 'quote';
              if (parsedPayload.contactId) {
                contact = await db.collection('contacts').findOne({ 
                  ghlContactId: parsedPayload.contactId 
                });
              }
            } else if (trigger.type === 'customer-reply-sms') {
              // SMS-related triggers
              entityType = 'contact';
              // Only lookup contact for SMS triggers
              if (parsedPayload.contactId) {
                contact = await db.collection('contacts').findOne({ 
                  ghlContactId: parsedPayload.contactId 
                });
              }
            }
           
           // Remove the redundant contact lookup - we only fetch when needed above
          
          // Create the automation queue entry
          await db.collection('automation_queue').insertOne({
            trigger: {
              type: trigger.type,
              entityType: entityType,
              locationId: trigger.locationId,
              stageId: trigger.stageId,
              pipelineId: parsedPayload.pipelineId,
              data: {
                projectId: project?._id?.toString(),
                contactId: contact?._id?.toString(),
                appointmentId: appointment?._id?.toString(),
                invoiceId: invoice?._id?.toString(),
                stageId: trigger.stageId,
                pipelineId: parsedPayload.pipelineId,
                depositRequired: project?.depositRequired || false,
                project: project ? {
                  _id: project._id,
                  name: project.name || project.title,
                  depositRequired: project.depositRequired || false,
                  monetaryValue: project.monetaryValue
                } : null,
                contact: contact ? {
                  _id: contact._id,
                  name: contact.fullName,
                  firstName: contact.firstName,
                  lastName: contact.lastName,
                  phone: contact.phone,
                  email: contact.email
                } : null,
                appointment: appointment ? {
                  _id: appointment._id,
                  title: appointment.title,
                  startTime: appointment.start,
                  endTime: appointment.end,
                  status: appointment.status
                } : null,
                invoice: invoice ? {
                  _id: invoice._id,
                  invoiceNumber: invoice.invoiceNumber,
                  amount: invoice.total || invoice.amount,
                  status: invoice.status
                } : null
              },
              timestamp: new Date()
            },
            status: 'pending',
            attempts: 0,
            createdAt: new Date()
          });
          
                     console.log('✅ Created automation trigger:', trigger.type, 'for stage:', trigger.stageId);
           
                       // Enhanced Ably publishing with more events
            if (ably) {
              // 1. Automation triggered event (you already have this)
              await ably.channels.get(`location:${parsedPayload.locationId}`).publish('automation.triggered', {
                type: trigger.type,
                projectId: project?._id,
                stageId: trigger.stageId,
                stageName: parsedPayload.pipelineStageName,
                projectName: project?.name || project?.title,
                timestamp: new Date().toISOString()
              });
              
              // 2. Project stage changed (you already have this)
              if (trigger.type === 'stage-entered') {
                await ably.channels.get(`location:${parsedPayload.locationId}`).publish('project.stage.changed', {
                  projectId: project?._id,
                  previousStage: trigger.previousStageId || project?.pipelineStageId,
                  newStage: parsedPayload.pipelineStageId,
                  project: {
                    id: project?._id,
                    title: project?.title,
                    value: project?.monetaryValue,
                    depositRequired: project?.depositRequired
                  }
                });
                
                // 3. Pipeline activity event for dashboard
                await ably.channels.get(`location:${parsedPayload.locationId}:pipeline:${parsedPayload.pipelineId}`).publish('stage.activity', {
                  type: 'project-moved',
                  projectId: project?._id,
                  projectName: project?.title,
                  fromStage: trigger.previousStageId,
                  toStage: parsedPayload.pipelineStageId,
                  userId: parsedPayload.assignedTo,
                  timestamp: new Date().toISOString()
                });
              }
              
              // 4. User-specific notification if assigned
              if (parsedPayload.assignedTo) {
                await ably.channels.get(`user:${parsedPayload.assignedTo}`).publish('project.assigned', {
                  projectId: project?._id,
                  projectName: project?.title,
                  stageId: trigger.stageId,
                  stageName: parsedPayload.pipelineStageName,
                  action: 'stage-automation',
                  timestamp: new Date().toISOString()
                });
              }
              
              // 5. Automation queue status for monitoring
              await ably.channels.get(`location:${parsedPayload.locationId}:automations`).publish('queue.added', {
                triggerType: trigger.type,
                stageId: trigger.stageId,
                projectId: project?._id,
                queueSize: await db.collection('automation_queue').countDocuments({ status: 'pending' }),
                timestamp: new Date().toISOString()
              });
            }

            // Enhanced Ably events for all trigger types
            if (ably) {
              // For contact events
              if (entityType === 'contact' && trigger.type === 'contact-assigned') {
                await ably.channels.get(`location:${parsedPayload.locationId}`).publish('contact.assigned', {
                  contactId: contact?._id,
                  contactName: contact?.fullName,
                  assignedTo: trigger.assignedUserId,
                  timestamp: new Date().toISOString()
                });
                
                if (trigger.assignedUserId) {
                  await ably.channels.get(`user:${trigger.assignedUserId}`).publish('contact.assigned', {
                    contactId: contact?._id,
                    contactName: contact?.fullName,
                    timestamp: new Date().toISOString()
                  });
                }
              }

              // For appointment events
              if (entityType === 'appointment') {
                const eventName = trigger.type.replace('-', '.');
                await ably.channels.get(`location:${parsedPayload.locationId}`).publish(eventName, {
                  appointmentId: appointment?._id,
                  title: appointment?.title,
                  status: appointment?.status,
                  timestamp: new Date().toISOString()
                });
              }

              // For invoice events
              if (entityType === 'invoice' && trigger.type === 'payment-received') {
                await ably.channels.get(`location:${parsedPayload.locationId}`).publish('payment.received', {
                  invoiceId: invoice?._id,
                  amount: invoice?.total || invoice?.amount,
                  contactName: contact?.fullName,
                  timestamp: new Date().toISOString()
                });
              }

              // For quote events
              if (trigger.type === 'quote-signed') {
                await ably.channels.get(`location:${parsedPayload.locationId}`).publish('quote.signed', {
                  quoteId: parsedPayload.id,
                  amount: parsedPayload.amount,
                  contactName: contact?.fullName,
                  timestamp: new Date().toISOString()
                });
              }

              // For task events
              if (entityType === 'task') {
                const eventName = trigger.type.replace('-', '.');
                await ably.channels.get(`location:${parsedPayload.locationId}`).publish(eventName, {
                  taskId: parsedPayload.id,
                  title: parsedPayload.title,
                  assignedTo: parsedPayload.assignedTo,
                  timestamp: new Date().toISOString()
                });
              }
            }
         }
        
        // Also queue automation processing as backup
        Promise.all(automationTriggers.map(async (trigger) => {
          try {
            // Find matching automation rules
            const rules = await db.collection('automation_rules').find({
              locationId: trigger.locationId,
              isActive: true,
              'trigger.type': trigger.type,
              $or: [
                { stageId: trigger.stageId },
                { stageId: { $exists: false } }
              ]
            }).toArray();

            // Queue each rule execution
            for (const rule of rules) {
              await db.collection('automation_queue').insertOne({
                ruleId: rule._id,
                trigger,
                status: 'pending',
                createdAt: new Date(),
                attempts: 0
              });
            }
          } catch (error) {
            console.error('Automation trigger error:', error);
          }
        })).catch(error => {
          console.error('Automation trigger error:', error);
          // Don't throw - we don't want automation errors to affect webhook processing
        });
      }
    } catch (automationError) {
      console.error('Automation processing error:', automationError);
      // Don't throw - continue with normal webhook response
    }

    // Always return success to GHL
    return res.status(200).json({ success: true, webhookId });

  } catch (error: unknown) {
    console.error(`[Native Webhook ${webhookId}] Fatal error:`, error);
    
    // Still return 200 to prevent GHL retries
    return res.status(200).json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error),
      webhookId 
    });
  }
}



// Vercel configuration
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};