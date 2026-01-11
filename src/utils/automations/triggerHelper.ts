import { Db, ObjectId } from 'mongodb';
import Ably from 'ably';

interface AutomationTrigger {
  type: string;
  entityType: string;
  entityId: string;
  locationId: string;
  stageId?: string;
  pipelineId?: string;
  data: any;
}

/**
 * Create an automation trigger in the queue
 */
export async function createAutomationTrigger(
  db: Db,
  trigger: AutomationTrigger
) {
  // Check if we should create this trigger (prevent duplicates within 5 seconds)
  const existingTrigger = await db.collection('automation_queue').findOne({
    'trigger.type': trigger.type,
    'trigger.entityId': trigger.entityId,
    'trigger.entityType': trigger.entityType,
    status: 'pending',
    createdAt: { $gte: new Date(Date.now() - 5000) } // Within last 5 seconds
  });

  if (existingTrigger) {
    console.log('Duplicate trigger detected, skipping:', trigger.type);
    return null;
  }

  // Get additional data if needed
  let project = null;
  let contact = null;
  
  if (trigger.entityType === 'project' && trigger.entityId) {
    project = await db.collection('projects').findOne({ 
      _id: new ObjectId(trigger.entityId) 
    });
  }
  
  if (trigger.data?.contactId) {
    contact = await db.collection('contacts').findOne({ 
      _id: new ObjectId(trigger.data.contactId) 
    });
  }

  // Create the trigger with proper structure for automation system
  const result = await db.collection('automation_queue').insertOne({
    trigger: {
      type: trigger.type,
      entityType: trigger.entityType,
      locationId: trigger.locationId,
      stageId: trigger.stageId,
      pipelineId: trigger.pipelineId,
      data: {
        ...trigger.data,
        // Add enriched data
        project: project ? {
          _id: project._id,
          name: project.name || project.title,
          depositRequired: project.depositRequired || false,
          monetaryValue: project.monetaryValue
        } : trigger.data.project,
        contact: contact ? {
          _id: contact._id,
          name: contact.fullName,
          firstName: contact.firstName,
          lastName: contact.lastName,
          phone: contact.phone,
          email: contact.email
        } : trigger.data.contact
      },
      timestamp: new Date()
    },
    status: 'pending',
    attempts: 0,
    createdAt: new Date()
  });

  console.log('✅ Automation trigger created:', trigger.type, trigger.entityId);
  return result;
}

/**
 * Publish event to Ably for real-time updates
 */
export async function publishAblyEvent(
  ably: Ably.Rest | null,
  channel: string,
  event: string,
  data: any
) {
  if (!ably) {
    console.log('[Ably] No Ably instance, skipping event:', event);
    return;
  }
  
  try {
    await ably.channels.get(channel).publish(event, {
      ...data,
      timestamp: new Date().toISOString()
    });
    console.log(`[Ably] Published ${event} to ${channel}`);
  } catch (error) {
    console.error(`[Ably] Failed to publish ${event}:`, error);
  }
}

/**
 * Get or create Ably instance
 */
export function getAblyInstance(): Ably.Rest | null {
  if (!process.env.ABLY_API_KEY) {
    console.log('[Ably] No API key found');
    return null;
  }
  return new Ably.Rest(process.env.ABLY_API_KEY);
}

/**
 * Trigger automation and publish Ably events for stage changes
 */
export async function triggerStageChangeAutomation(
  db: Db,
  params: {
    projectId: string;
    previousStageId?: string;
    newStageId: string;
    pipelineId: string;
    locationId: string;
    contactId?: string;
    assignedUserId?: string;
    projectName?: string;
    monetaryValue?: number;
  }
) {
  const ably = getAblyInstance();
  
  // Create automation trigger
  await createAutomationTrigger(db, {
            type: 'stage-entered',
    entityType: 'project',
    entityId: params.projectId,
    locationId: params.locationId,
    stageId: params.newStageId,
    pipelineId: params.pipelineId,
    data: {
      projectId: params.projectId,
      previousStageId: params.previousStageId,
      newStageId: params.newStageId,
      contactId: params.contactId,
      assignedUserId: params.assignedUserId,
      depositRequired: false // Will be enriched by createAutomationTrigger
    }
  });
  
  // Publish multiple Ably events
  await publishAblyEvent(ably, `location:${params.locationId}`, 'project.stage.changed', {
    projectId: params.projectId,
    previousStage: params.previousStageId,
    newStage: params.newStageId,
    project: {
      id: params.projectId,
      title: params.projectName,
      value: params.monetaryValue
    }
  });
  
  await publishAblyEvent(
    ably, 
    `location:${params.locationId}:pipeline:${params.pipelineId}`, 
    'stage.activity',
    {
      type: 'project-moved',
      projectId: params.projectId,
      projectName: params.projectName,
      fromStage: params.previousStageId,
      toStage: params.newStageId,
      userId: params.assignedUserId
    }
  );
  
  // Notify assigned user
  if (params.assignedUserId) {
    await publishAblyEvent(ably, `user:${params.assignedUserId}`, 'project.stage.changed', {
      projectId: params.projectId,
      projectName: params.projectName,
      stageId: params.newStageId,
      action: 'stage-automation'
    });
  }
  
  // Automation monitoring channel
  await publishAblyEvent(ably, `location:${params.locationId}:automations`, 'queue.added', {
            triggerType: 'stage-entered',
    stageId: params.newStageId,
    projectId: params.projectId
  });
}

/**
 * Trigger automation for quote events
 */
export async function triggerQuoteAutomation(
  db: Db,
  params: {
    quoteId: string;
    projectId?: string;
    contactId?: string;
    locationId: string;
    eventType: 'quote-signed' | 'quote-viewed' | 'quote-sent' | 'quote-created';
    amount?: number;
    quoteName?: string;
  }
) {
  const ably = getAblyInstance();
  
  await createAutomationTrigger(db, {
    type: params.eventType,
    entityType: 'quote',
    entityId: params.quoteId,
    locationId: params.locationId,
    data: {
      quoteId: params.quoteId,
      projectId: params.projectId,
      contactId: params.contactId,
      amount: params.amount,
      timestamp: new Date()
    }
  });
  
  await publishAblyEvent(ably, `location:${params.locationId}`, params.eventType.replace(':', '.'), {
    quoteId: params.quoteId,
    projectId: params.projectId,
    amount: params.amount,
    quoteName: params.quoteName
  });
}

/**
 * Trigger automation for contact events
 */
export async function triggerContactAutomation(
  db: Db,
  params: {
    contactId: string;
    locationId: string;
          eventType: 'contact-assigned' | 'contact-created' | 'contact-updated';
    assignedUserId?: string;
    previousUserId?: string;
    contactName?: string;
  }
) {
  const ably = getAblyInstance();
  
  // Use event type directly since it's already in correct format
  const automationType = params.eventType;
  
  // Create the trigger in the queue (this is the main approach)
  await createAutomationTrigger(db, {
    type: automationType,
    entityType: 'contact',
    entityId: params.contactId,
    locationId: params.locationId,
    data: {
      contactId: params.contactId,
      assignedUserId: params.assignedUserId,
      previousUserId: params.previousUserId,
      assignedTo: params.assignedUserId
    }
  });
  
  console.log('✅ Contact automation trigger queued:', automationType);
  
  // Location-wide event
  await publishAblyEvent(ably, `location:${params.locationId}`, params.eventType.replace(':', '.'), {
    contactId: params.contactId,
    contactName: params.contactName,
    assignedUserId: params.assignedUserId
  });
  
  // User-specific event if assigned
  if (params.assignedUserId) {
    await publishAblyEvent(ably, `user:${params.assignedUserId}`, 'contact.assigned', {
      contactId: params.contactId,
      contactName: params.contactName
    });
  }
}

/**
 * Trigger automation for appointment events
 */
export async function triggerAppointmentAutomation(
  db: Db,
  params: {
    appointmentId: string;
    locationId: string;
          eventType: 'appointment-scheduled' | 'appointment-cancelled' | 'appointment-completed' | 'appointment-updated';
    contactId?: string;
    projectId?: string;
    assignedTo?: string;
    startTime?: Date;
    title?: string;
  }
) {
  const ably = getAblyInstance();
  
  await createAutomationTrigger(db, {
    type: params.eventType,
    entityType: 'appointment',
    entityId: params.appointmentId,
    locationId: params.locationId,
    data: {
      appointmentId: params.appointmentId,
      contactId: params.contactId,
      projectId: params.projectId,
      assignedTo: params.assignedTo,
      startTime: params.startTime
    }
  });
  
  await publishAblyEvent(ably, `location:${params.locationId}`, params.eventType.replace(':', '.'), {
    appointmentId: params.appointmentId,
    title: params.title,
    startTime: params.startTime,
    assignedTo: params.assignedTo
  });
  
  // Notify assigned user
  if (params.assignedTo) {
    await publishAblyEvent(ably, `user:${params.assignedTo}`, params.eventType.replace(':', '.'), {
      appointmentId: params.appointmentId,
      title: params.title,
      startTime: params.startTime
    });
  }
}

/**
 * Trigger automation for task events
 */
export async function triggerTaskAutomation(
  db: Db,
  params: {
    taskId: string;
    locationId: string;
    eventType: 'task:created' | 'task:completed' | 'task:assigned' | 'task:updated';
    assignedTo?: string;
    contactId?: string;
    projectId?: string;
    title?: string;
  }
) {
  const ably = getAblyInstance();
  
  await createAutomationTrigger(db, {
    type: params.eventType,
    entityType: 'task',
    entityId: params.taskId,
    locationId: params.locationId,
    data: {
      taskId: params.taskId,
      assignedTo: params.assignedTo,
      contactId: params.contactId,
      projectId: params.projectId
    }
  });
  
  await publishAblyEvent(ably, `location:${params.locationId}`, params.eventType.replace(':', '.'), {
    taskId: params.taskId,
    title: params.title,
    assignedTo: params.assignedTo
  });
  
  if (params.assignedTo) {
    await publishAblyEvent(ably, `user:${params.assignedTo}`, params.eventType.replace(':', '.'), {
      taskId: params.taskId,
      title: params.title
    });
  }
}

/**
 * Trigger automation for invoice/payment events
 */
export async function triggerInvoiceAutomation(
  db: Db,
  params: {
    invoiceId: string;
    locationId: string;
          eventType: 'invoice-paid' | 'invoice-sent' | 'invoice-created' | 'payment-received' | 'invoice-deleted' | 'payment-link-created';
    contactId?: string;
    projectId?: string;
    amount?: number;
    invoiceNumber?: string;
  }
) {
  const ably = getAblyInstance();
  
  await createAutomationTrigger(db, {
    type: params.eventType,
    entityType: 'invoice',
    entityId: params.invoiceId,
    locationId: params.locationId,
    data: {
      invoiceId: params.invoiceId,
      contactId: params.contactId,
      projectId: params.projectId,
      amount: params.amount
    }
  });
  
  await publishAblyEvent(ably, `location:${params.locationId}`, params.eventType.replace(':', '.'), {
    invoiceId: params.invoiceId,
    invoiceNumber: params.invoiceNumber,
    amount: params.amount,
    contactId: params.contactId
  });
}
