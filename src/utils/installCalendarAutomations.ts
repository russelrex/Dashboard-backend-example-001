/**
 * File: installCalendarAutomations.ts
 * Purpose: Flash calendar-specific templates and automation rules during location install
 * Author: LPai Team
 * Last Modified: 2025-10-15
 * Dependencies: MongoDB, sms_templates, email_templates, automation_rules collections
 */

import { Db, ObjectId } from 'mongodb';

// Standard calendar names we install on every location
const STANDARD_CALENDARS = {
  QUOTE: 'Quote Calendar',
  FIELD_WORK: 'Field Work',
  CUSTOMER_WALKTHRU: 'Customer Walk-Thru'
};

interface TemplateReference {
  smsTemplateId?: ObjectId;
  emailTemplateId?: ObjectId;
}

/**
 * Flash calendar-specific templates and automation rules for a location
 * Call this AFTER calendars have been synced from GHL
 */
export async function flashCalendarAutomations(
  db: Db,
  locationId: string
): Promise<{
  success: boolean;
  templatesCreated: number;
  automationsCreated: number;
  calendarsProcessed: string[];
  errors?: string[];
}> {
  console.log(`[Calendar Automations] Flashing templates and rules for location: ${locationId}`);
  
  const errors: string[] = [];
  const calendarsProcessed: string[] = [];
  let templatesCreated = 0;
  let automationsCreated = 0;

  try {
    // 1. Fetch location's calendars from MongoDB
    const location = await db.collection('locations').findOne({ locationId });
    if (!location || !location.calendars) {
      return {
        success: false,
        templatesCreated: 0,
        automationsCreated: 0,
        calendarsProcessed: [],
        errors: ['Location not found or has no calendars']
      };
    }

    // 2. Find our standard calendars by name
    const quoteCalendar = location.calendars.find((cal: any) => 
      cal.name === STANDARD_CALENDARS.QUOTE
    );
    const fieldWorkCalendar = location.calendars.find((cal: any) => 
      cal.name === STANDARD_CALENDARS.FIELD_WORK
    );
    const walkthruCalendar = location.calendars.find((cal: any) => 
      cal.name === STANDARD_CALENDARS.CUSTOMER_WALKTHRU
    );

    // 3. Create templates and automations for each calendar
    if (quoteCalendar) {
      const result = await setupQuoteCalendarAutomations(db, locationId, quoteCalendar.id);
      templatesCreated += result.templatesCreated;
      automationsCreated += result.automationsCreated;
      calendarsProcessed.push(STANDARD_CALENDARS.QUOTE);
    } else {
      errors.push(`${STANDARD_CALENDARS.QUOTE} not found`);
    }

    if (fieldWorkCalendar) {
      const result = await setupFieldWorkCalendarAutomations(db, locationId, fieldWorkCalendar.id);
      templatesCreated += result.templatesCreated;
      automationsCreated += result.automationsCreated;
      calendarsProcessed.push(STANDARD_CALENDARS.FIELD_WORK);
    } else {
      errors.push(`${STANDARD_CALENDARS.FIELD_WORK} not found`);
    }

    if (walkthruCalendar) {
      const result = await setupWalkthruCalendarAutomations(db, locationId, walkthruCalendar.id);
      templatesCreated += result.templatesCreated;
      automationsCreated += result.automationsCreated;
      calendarsProcessed.push(STANDARD_CALENDARS.CUSTOMER_WALKTHRU);
    } else {
      errors.push(`${STANDARD_CALENDARS.CUSTOMER_WALKTHRU} not found`);
    }

    console.log(`[Calendar Automations] Created ${templatesCreated} templates and ${automationsCreated} automations for ${calendarsProcessed.length} calendars`);

    return {
      success: true,
      templatesCreated,
      automationsCreated,
      calendarsProcessed,
      errors: errors.length > 0 ? errors : undefined
    };

  } catch (error: any) {
    console.error('[Calendar Automations] Error flashing templates:', error);
    return {
      success: false,
      templatesCreated,
      automationsCreated,
      calendarsProcessed,
      errors: [error.message]
    };
  }
}

/**
 * Setup Quote Calendar templates and automations
 */
async function setupQuoteCalendarAutomations(
  db: Db,
  locationId: string,
  calendarId: string
): Promise<{ templatesCreated: number; automationsCreated: number }> {
  
  // Check if already exists
  const existingCount = await db.collection('automation_rules').countDocuments({
    locationId,
    calendarId,
    isCalendarAutomation: true
  });

  if (existingCount > 0) {
    console.log(`[Calendar Automations] Skipping Quote Calendar - already has ${existingCount} automations`);
    return { templatesCreated: 0, automationsCreated: 0 };
  }

  // 1. Create SMS Templates
  const smsTemplates = [
    {
      name: 'Quote Appointment Confirmation',
      category: 'appointment',
      calendarType: 'quote',
      message: 'Hi {{contact.firstName}}, your {{project.name}} estimate is confirmed for {{appointment.date}} at {{appointment.time}}! Reply R if you need to reschedule.'
    },
    {
      name: 'Quote Appointment 24hr Reminder',
      category: 'appointment',
      calendarType: 'quote',
      message: 'Hi {{contact.firstName}}, just a reminder about our appointment tomorrow at {{appointment.time}} for your {{project.name}} estimate. Reply R if you need to reschedule.'
    },
    {
      name: 'Quote Appointment 1hr Reminder',
      category: 'appointment',
      calendarType: 'quote',
      message: 'Hi {{contact.firstName}}, this is a reminder that your {{project.name}} appointment is in 1 hour at {{appointment.time}}. I\'ll text you when I\'m on my way!'
    },
    {
      name: 'Quote Appointment Rescheduled',
      category: 'appointment',
      calendarType: 'quote',
      message: 'Hi {{contact.firstName}}, your {{project.name}} appointment has been rescheduled to {{appointment.date}} at {{appointment.time}}. See you then!'
    },
    {
      name: 'Quote Appointment Cancelled',
      category: 'appointment',
      calendarType: 'quote',
      message: 'Hi {{contact.firstName}}, your {{project.name}} appointment has been cancelled. Please call us at {{location.phone}} to reschedule. Thanks!'
    }
  ];

  const createdSmsTemplates: ObjectId[] = [];
  for (const template of smsTemplates) {
    const result = await db.collection('sms_templates').insertOne({
      _id: new ObjectId(),
      locationId,
      calendarId,
      name: template.name,
      category: template.category,
      calendarType: template.calendarType,
      message: template.message,
      isSystemTemplate: true,
      isCalendarTemplate: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    createdSmsTemplates.push(result.insertedId);
  }

  // 2. Create Automation Rules that reference these templates
  const automations = [
    {
      name: 'Quote Appointment Confirmation',
      description: 'Sends confirmation immediately when quote appointment is scheduled',
      trigger: {
        type: 'appointment-scheduled',
        entityType: 'appointment'
      },
      actions: [{
        type: 'send-sms',
        config: {
          recipient: 'contact',
          templateId: createdSmsTemplates[0].toString() // ✅ Reference template
        }
      }],
      priority: 10
    },
    {
      name: 'Quote Appointment 24hr Reminder',
      description: 'Reminds customer 24 hours before quote appointment',
      trigger: {
        type: 'time-based',
        entityType: 'appointment',
        config: {
          delayHours: -24,
          fromEvent: 'appointment:start'
        }
      },
      actions: [{
        type: 'send-sms',
        config: {
          recipient: 'contact',
          templateId: createdSmsTemplates[1].toString() // ✅ Reference template
        }
      }],
      priority: 9
    },
    {
      name: 'Quote Appointment 1hr Reminder',
      description: 'Reminds customer 1 hour before quote appointment',
      trigger: {
        type: 'time-based',
        entityType: 'appointment',
        config: {
          delayHours: -1,
          fromEvent: 'appointment:start'
        }
      },
      actions: [{
        type: 'send-sms',
        config: {
          recipient: 'contact',
          templateId: createdSmsTemplates[2].toString() // ✅ Reference template
        }
      }],
      priority: 8
    },
    {
      name: 'Quote Appointment Rescheduled',
      description: 'Notifies customer when appointment is rescheduled',
      trigger: {
        type: 'appointment-rescheduled',
        entityType: 'appointment'
      },
      actions: [{
        type: 'send-sms',
        config: {
          recipient: 'contact',
          templateId: createdSmsTemplates[3].toString() // ✅ Reference template
        }
      }],
      priority: 10
    },
    {
      name: 'Quote Appointment Cancelled',
      description: 'Notifies customer when appointment is cancelled',
      trigger: {
        type: 'appointment-cancelled',
        entityType: 'appointment'
      },
      actions: [{
        type: 'send-sms',
        config: {
          recipient: 'contact',
          templateId: createdSmsTemplates[4].toString() // ✅ Reference template
        }
      }],
      priority: 10
    }
  ];

  const automationDocs = automations.map(auto => ({
    _id: new ObjectId(),
    locationId,
    calendarId,
    name: auto.name,
    description: auto.description,
    isActive: true,
    isTemplate: true,
    isCalendarAutomation: true,
    priority: auto.priority,
    trigger: auto.trigger,
    conditions: [
      {
        field: 'calendarId',
        operator: 'equals',
        value: calendarId
      }
    ],
    actions: auto.actions,
    executionStats: {
      executionCount: 0,
      successCount: 0,
      failureCount: 0
    },
    source: 'auto_install',
    createdAt: new Date(),
    updatedAt: new Date()
  }));

  await db.collection('automation_rules').insertMany(automationDocs);

  return {
    templatesCreated: createdSmsTemplates.length,
    automationsCreated: automationDocs.length
  };
}

/**
 * Setup Field Work Calendar templates and automations
 */
async function setupFieldWorkCalendarAutomations(
  db: Db,
  locationId: string,
  calendarId: string
): Promise<{ templatesCreated: number; automationsCreated: number }> {
  
  const existingCount = await db.collection('automation_rules').countDocuments({
    locationId,
    calendarId,
    isCalendarAutomation: true
  });

  if (existingCount > 0) {
    console.log(`[Calendar Automations] Skipping Field Work Calendar - already has ${existingCount} automations`);
    return { templatesCreated: 0, automationsCreated: 0 };
  }

  const smsTemplates = [
    {
      name: 'Field Work Appointment Confirmation',
      category: 'appointment',
      calendarType: 'field_work',
      message: 'Hi {{contact.firstName}}, your {{project.name}} field work is scheduled for {{appointment.date}} at {{appointment.time}}. We\'ll text you when the crew is on the way!'
    },
    {
      name: 'Field Work 24hr Reminder',
      category: 'appointment',
      calendarType: 'field_work',
      message: 'Hi {{contact.firstName}}, reminder that our crew will be at your property tomorrow at {{appointment.time}} for {{project.name}}. Please ensure access is available!'
    },
    {
      name: 'Field Work 1hr Reminder',
      category: 'appointment',
      calendarType: 'field_work',
      message: 'Hi {{contact.firstName}}, our crew will be arriving in about 1 hour for your {{project.name}} work. We\'ll text when we\'re 15 minutes away!'
    },
    {
      name: 'Field Work Rescheduled',
      category: 'appointment',
      calendarType: 'field_work',
      message: 'Hi {{contact.firstName}}, your {{project.name}} field work has been rescheduled to {{appointment.date}} at {{appointment.time}}. Thanks for your understanding!'
    },
    {
      name: 'Field Work Cancelled',
      category: 'appointment',
      calendarType: 'field_work',
      message: 'Hi {{contact.firstName}}, your {{project.name}} field work has been cancelled. Please call {{location.phone}} to reschedule.'
    }
  ];

  const createdSmsTemplates: ObjectId[] = [];
  for (const template of smsTemplates) {
    const result = await db.collection('sms_templates').insertOne({
      _id: new ObjectId(),
      locationId,
      calendarId,
      name: template.name,
      category: template.category,
      calendarType: template.calendarType,
      message: template.message,
      isSystemTemplate: true,
      isCalendarTemplate: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    createdSmsTemplates.push(result.insertedId);
  }

  const automations = [
    {
      name: 'Field Work Appointment Confirmation',
      trigger: { type: 'appointment-scheduled', entityType: 'appointment' },
      actions: [{ type: 'send-sms', config: { recipient: 'contact', templateId: createdSmsTemplates[0].toString() }}],
      priority: 10
    },
    {
      name: 'Field Work 24hr Reminder',
      trigger: { type: 'time-based', entityType: 'appointment', config: { delayHours: -24, fromEvent: 'appointment:start' }},
      actions: [{ type: 'send-sms', config: { recipient: 'contact', templateId: createdSmsTemplates[1].toString() }}],
      priority: 9
    },
    {
      name: 'Field Work 1hr Reminder',
      trigger: { type: 'time-based', entityType: 'appointment', config: { delayHours: -1, fromEvent: 'appointment:start' }},
      actions: [{ type: 'send-sms', config: { recipient: 'contact', templateId: createdSmsTemplates[2].toString() }}],
      priority: 8
    },
    {
      name: 'Field Work Rescheduled',
      trigger: { type: 'appointment-rescheduled', entityType: 'appointment' },
      actions: [{ type: 'send-sms', config: { recipient: 'contact', templateId: createdSmsTemplates[3].toString() }}],
      priority: 10
    },
    {
      name: 'Field Work Cancelled',
      trigger: { type: 'appointment-cancelled', entityType: 'appointment' },
      actions: [{ type: 'send-sms', config: { recipient: 'contact', templateId: createdSmsTemplates[4].toString() }}],
      priority: 10
    }
  ];

  const automationDocs = automations.map((auto, idx) => ({
    _id: new ObjectId(),
    locationId,
    calendarId,
    name: auto.name,
    description: smsTemplates[idx].name,
    isActive: true,
    isTemplate: true,
    isCalendarAutomation: true,
    priority: auto.priority,
    trigger: auto.trigger,
    conditions: [{ field: 'calendarId', operator: 'equals', value: calendarId }],
    actions: auto.actions,
    executionStats: { executionCount: 0, successCount: 0, failureCount: 0 },
    source: 'auto_install',
    createdAt: new Date(),
    updatedAt: new Date()
  }));

  await db.collection('automation_rules').insertMany(automationDocs);

  return {
    templatesCreated: createdSmsTemplates.length,
    automationsCreated: automationDocs.length
  };
}

/**
 * Setup Customer Walk-thru Calendar templates and automations
 */
async function setupWalkthruCalendarAutomations(
  db: Db,
  locationId: string,
  calendarId: string
): Promise<{ templatesCreated: number; automationsCreated: number }> {
  
  const existingCount = await db.collection('automation_rules').countDocuments({
    locationId,
    calendarId,
    isCalendarAutomation: true
  });

  if (existingCount > 0) {
    console.log(`[Calendar Automations] Skipping Walk-thru Calendar - already has ${existingCount} automations`);
    return { templatesCreated: 0, automationsCreated: 0 };
  }

  const smsTemplates = [
    {
      name: 'Walk-thru Appointment Confirmation',
      category: 'appointment',
      calendarType: 'walkthru',
      message: 'Hi {{contact.firstName}}, your {{project.name}} final walk-thru is scheduled for {{appointment.date}} at {{appointment.time}}. Looking forward to showing you the completed work!'
    },
    {
      name: 'Walk-thru 24hr Reminder',
      category: 'appointment',
      calendarType: 'walkthru',
      message: 'Hi {{contact.firstName}}, reminder: tomorrow at {{appointment.time}} we\'ll do the final walk-thru of your {{project.name}}. Please bring any questions you have!'
    },
    {
      name: 'Walk-thru 1hr Reminder',
      category: 'appointment',
      calendarType: 'walkthru',
      message: 'Hi {{contact.firstName}}, I\'ll be there in about 1 hour for your {{project.name}} walk-thru. See you soon!'
    },
    {
      name: 'Walk-thru Rescheduled',
      category: 'appointment',
      calendarType: 'walkthru',
      message: 'Hi {{contact.firstName}}, your {{project.name}} walk-thru has been rescheduled to {{appointment.date}} at {{appointment.time}}.'
    },
    {
      name: 'Walk-thru Cancelled',
      category: 'appointment',
      calendarType: 'walkthru',
      message: 'Hi {{contact.firstName}}, your {{project.name}} walk-thru has been cancelled. Please call {{location.phone}} to reschedule.'
    }
  ];

  const createdSmsTemplates: ObjectId[] = [];
  for (const template of smsTemplates) {
    const result = await db.collection('sms_templates').insertOne({
      _id: new ObjectId(),
      locationId,
      calendarId,
      name: template.name,
      category: template.category,
      calendarType: template.calendarType,
      message: template.message,
      isSystemTemplate: true,
      isCalendarTemplate: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    createdSmsTemplates.push(result.insertedId);
  }

  const automations = [
    {
      name: 'Walk-thru Appointment Confirmation',
      trigger: { type: 'appointment-scheduled', entityType: 'appointment' },
      actions: [{ type: 'send-sms', config: { recipient: 'contact', templateId: createdSmsTemplates[0].toString() }}],
      priority: 10
    },
    {
      name: 'Walk-thru 24hr Reminder',
      trigger: { type: 'time-based', entityType: 'appointment', config: { delayHours: -24, fromEvent: 'appointment:start' }},
      actions: [{ type: 'send-sms', config: { recipient: 'contact', templateId: createdSmsTemplates[1].toString() }}],
      priority: 9
    },
    {
      name: 'Walk-thru 1hr Reminder',
      trigger: { type: 'time-based', entityType: 'appointment', config: { delayHours: -1, fromEvent: 'appointment:start' }},
      actions: [{ type: 'send-sms', config: { recipient: 'contact', templateId: createdSmsTemplates[2].toString() }}],
      priority: 8
    },
    {
      name: 'Walk-thru Rescheduled',
      trigger: { type: 'appointment-rescheduled', entityType: 'appointment' },
      actions: [{ type: 'send-sms', config: { recipient: 'contact', templateId: createdSmsTemplates[3].toString() }}],
      priority: 10
    },
    {
      name: 'Walk-thru Cancelled',
      trigger: { type: 'appointment-cancelled', entityType: 'appointment' },
      actions: [{ type: 'send-sms', config: { recipient: 'contact', templateId: createdSmsTemplates[4].toString() }}],
      priority: 10
    }
  ];

  const automationDocs = automations.map((auto, idx) => ({
    _id: new ObjectId(),
    locationId,
    calendarId,
    name: auto.name,
    description: smsTemplates[idx].name,
    isActive: true,
    isTemplate: true,
    isCalendarAutomation: true,
    priority: auto.priority,
    trigger: auto.trigger,
    conditions: [{ field: 'calendarId', operator: 'equals', value: calendarId }],
    actions: auto.actions,
    executionStats: { executionCount: 0, successCount: 0, failureCount: 0 },
    source: 'auto_install',
    createdAt: new Date(),
    updatedAt: new Date()
  }));

  await db.collection('automation_rules').insertMany(automationDocs);

  return {
    templatesCreated: createdSmsTemplates.length,
    automationsCreated: automationDocs.length
  };
}