const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://mobileApp:A602ZiVx1ZrZpACw@leadprospectcluster.ujmqx.mongodb.net/lpai?retryWrites=true&w=majority';

// SPECIFIC LOCATION AND PIPELINE
const LOCATION_ID = '5OuaTrizW5wkZMI1xtvX';
const PIPELINE_ID = '9cGrqJIQlofiY1Ehj8xf';

// ACTUAL STAGE IDS FROM YOUR PIPELINE
const STAGES = {
  CREATED: 'b4d9e2ef-672c-4f3b-8440-f259ea968ae7',
  VISIT_SCHEDULED: '2b699ead-3ab3-4664-9cc4-361e349fea2c',
  VISIT_DONE: '8b7f58d9-b881-4425-b4e6-8d5fe8196f51',
  QUOTING: '2113e1be-5d38-497e-bbdb-083f07f11290',
  QUOTE_SENT: 'd555045c-9857-4dba-8690-9631068b847e',
  VIEWED: '8ef323fa-0f00-4a29-b1c9-2237ce36be83',
  ACCEPTED: 'cb72a0ac-2462-4e9c-8450-54865d02038e',
  SIGNED: 'b48699ce-5a88-4ecd-a2e0-aec07219bc22',
  DEPOSIT: '0a3414cd-bc81-43fa-9b4b-f98906995f99'
};

console.log('Using MongoDB URI:', MONGODB_URI.substring(0, 20) + '...');
console.log(`Creating automations for Location: ${LOCATION_ID}, Pipeline: ${PIPELINE_ID}`);

// Helper function to generate consistent automation IDs
const generateId = () => new ObjectId().toString();

// ALL automation rules for this specific location
const estimatesAutomations = [
  // ============= STAGE: CREATED =============
  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "New Lead Assignment & Notification",
    description: "Assigns consultant and sends initial acknowledgment when a new lead is created",
    isActive: true,
    priority: 10,
    trigger: {
      type: "stage-entered",
      entityType: "project",
      stageId: STAGES.CREATED,
      pipelineId: PIPELINE_ID
    },
    conditions: [],
    actions: [
      {
        type: "assign-user",
        config: {
          method: "round-robin",
          userRole: "consultant",
          updateField: "assignedUserId"
        }
      },
      {
        type: "push-notification",
        config: {
          recipientType: "assigned-user",
          template: {
            title: "🔥 New Lead Assigned",
            body: "{{contact.name}} - {{project.serviceType}}",
            priority: 10,
            data: {
              type: "new-lead",
              projectId: "{{project._id}}"
            }
          }
        }
      },
      {
        type: "create-task",
        config: {
          title: "New Lead: Contact {{contact.name}}",
          assignTo: "{{project.assignedUserId}}",
          dueInHours: 2,
          priority: "high",
          taskType: "new-lead-contact"
        }
      },
      {
        type: "send-sms",
        config: {
          recipient: "contact",
          requireApproval: true,
          checkOptIn: true,
          template: "new-lead-acknowledgment",
          message: "Hi {{contact.firstName}}! Thanks for contacting {{location.name}}. We'll call you within 2 hours regarding your {{project.serviceType}} request."
        }
      },
      {
        type: "send-email",
        config: {
          recipient: "contact",
          template: "new-lead-welcome",
          requireApproval: false
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "Lead Response Overdue Warning",
    description: "Alerts consultant when 1 hour left to contact lead",
    isActive: true,
    priority: 8,
    trigger: {
      type: "time-based",
      entityType: "project",
      config: {
        delayMinutes: 60,
        fromEvent: "stage-entered",
        stageId: STAGES.CREATED
      }
    },
    conditions: [
      {
        type: "stage-equals",
        field: "stage",
        operator: "equals",
        value: STAGES.CREATED
      }
    ],
    actions: [
      {
        type: "push-notification",
        config: {
          recipientType: "assigned-user",
          template: {
            title: "⚠️ Lead Response Due Soon",
            body: "1 hour left to contact {{contact.name}}",
            priority: 9
          }
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "Lead Response Overdue Escalation",
    description: "Escalates to manager after 2 hours without response",
    isActive: true,
    priority: 10,
    trigger: {
      type: "time-based",
      entityType: "project",
      config: {
        delayMinutes: 120,
        fromEvent: "stage-entered",
        stageId: STAGES.CREATED
      }
    },
    conditions: [
      {
        type: "stage-equals",
        field: "stage",
        operator: "equals",
        value: STAGES.CREATED
      }
    ],
    actions: [
      {
        type: "push-notification",
        config: {
          recipientType: "role",
          recipientRole: "manager",
          template: {
            title: "🚨 OVERDUE Lead Response",
            body: "{{consultant.name}} hasn't contacted {{contact.name}}",
            priority: 10
          }
        }
      },
      {
        type: "create-task",
        config: {
          title: "OVERDUE: Contact {{contact.name}} IMMEDIATELY",
          assignTo: "{{project.assignedUserId}}",
          priority: "urgent",
          escalated: true
        }
      },
      {
        type: "send-sms",
        config: {
          recipient: "contact",
          checkOptIn: true,
          requireApproval: false,
          template: "overdue-apology",
          message: "Hi {{contact.firstName}}, we apologize for the delay. When is a good time to call you today?"
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  // ============= STAGE: VISIT SCHEDULED =============
  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "Appointment Scheduled Confirmation",
    description: "Sends confirmations when estimate appointment is booked",
    isActive: true,
    priority: 10,
    trigger: {
      type: "appointment-created",
      entityType: "appointment",
      config: {
        calendarIds: "{{location.estimatesCalendars}}"
      }
    },
    conditions: [],
    actions: [
      {
        type: "move-to-stage",
        config: {
          pipelineId: PIPELINE_ID,
          stageId: STAGES.VISIT_SCHEDULED
        }
      },
      {
        type: "send-sms",
        config: {
          recipient: "contact",
          checkOptIn: true,
          requireApproval: false,
          template: "appointment-confirmation",
          message: "✅ Estimate scheduled!\n\n📅 {{appointment.date}} at {{appointment.time}}\n📍 {{project.address}}\n👷 {{consultant.name}}\n\nReply R to reschedule"
        }
      },
      {
        type: "send-email",
        config: {
          recipient: "contact",
          template: "appointment-confirmation-email",
          attachCalendarFile: true
        }
      },
      {
        type: "update-ably",
        config: {
          channel: "location:{{location._id}}:calendar",
          event: "appointment.scheduled",
          data: {
            appointment: "{{appointment}}",
            project: "{{project}}"
          }
        }
      },
      {
        type: "create-task",
        config: {
          title: "Prepare for estimate: {{contact.name}}",
          assignTo: "{{consultant.userId}}",
          dueInHours: -1,
          priority: "medium",
          checklist: [
            "Review property details",
            "Check previous quotes in area",
            "Prepare measurement tools",
            "Charge tablet/phone"
          ]
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "24-Hour Appointment Reminder",
    description: "Reminds customer and consultant day before appointment",
    isActive: true,
    priority: 8,
    trigger: {
      type: "time-based",
      entityType: "appointment",
      config: {
        delayHours: -24,
        fromEvent: "appointment-start"
      }
    },
    conditions: [
      {
        type: "stage-equals",
        field: "project.stage",
        operator: "equals",
        value: STAGES.VISIT_SCHEDULED
      }
    ],
    actions: [
      {
        type: "send-sms",
        config: {
          recipient: "contact",
          checkOptIn: true,
          requireApproval: true,
          template: "appointment-reminder-24h",
          message: "Reminder: {{consultant.name}} will visit tomorrow at {{appointment.time}} for your {{project.serviceType}} estimate. Reply R to reschedule."
        }
      },
      {
        type: "send-email",
        config: {
          recipient: "contact",
          template: "appointment-reminder-24h",
          requireApproval: false
        }
      },
      {
        type: "push-notification",
        config: {
          recipientType: "assigned-user",
          template: {
            title: "📅 Tomorrow's Estimate",
            body: "{{contact.name}} at {{appointment.time}}"
          }
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "2-Hour Appointment Reminder",
    description: "Final reminder 2 hours before appointment",
    isActive: true,
    priority: 9,
    trigger: {
      type: "time-based",
      entityType: "appointment",
      config: {
        delayHours: -2,
        fromEvent: "appointment-start"
      }
    },
    conditions: [
      {
        type: "stage-equals",
        field: "project.stage",
        operator: "equals",
        value: STAGES.VISIT_SCHEDULED
      }
    ],
    actions: [
      {
        type: "send-sms",
        config: {
          recipient: "contact",
          checkOptIn: true,
          requireApproval: false,
          template: "appointment-reminder-2h",
          message: "{{consultant.name}} will arrive between {{appointment.timeWindow}} today. We'll text when on the way."
        }
      },
      {
        type: "enable-tracking",
        config: {
          userId: "{{consultant.userId}}",
          appointmentId: "{{appointment._id}}",
          duration: 14400
        }
      },
      {
        type: "push-notification",
        config: {
          recipientType: "assigned-user",
          template: {
            title: "⏰ Appointment in 2 hours",
            body: "{{contact.name}} - {{project.address}}",
            priority: 8
          }
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  // ============= STAGE: VISIT DONE =============
  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "Auto-Move to Visit Done",
    description: "Automatically moves to Visit Done after appointment time",
    isActive: true,
    priority: 10,
    trigger: {
      type: "time-based",
      entityType: "appointment",
      config: {
        delayMinutes: 60,
        fromEvent: "appointment-end"
      }
    },
    conditions: [
      {
        type: "stage-equals",
        field: "project.stage",
        operator: "equals",
        value: STAGES.VISIT_SCHEDULED
      }
    ],
    actions: [
      {
        type: "move-to-stage",
        config: {
          pipelineId: PIPELINE_ID,
          stageId: STAGES.VISIT_DONE
        }
      },
      {
        type: "create-task",
        config: {
          title: "Complete quote for {{contact.name}}",
          assignTo: "{{project.assignedUserId}}",
          dueInHours: 24,
          priority: "high",
          checklist: [
            "Review photos and measurements",
            "Calculate materials needed",
            "Apply current pricing",
            "Add labor estimates",
            "Review for accuracy"
          ]
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "Visit Complete Thank You",
    description: "Thanks customer after estimate visit",
    isActive: true,
    priority: 7,
    trigger: {
      type: "stage-entered",
      entityType: "project",
      stageId: STAGES.VISIT_DONE,
      pipelineId: PIPELINE_ID
    },
    conditions: [],
    actions: [
      {
        type: "send-sms",
        config: {
          recipient: "contact",
          checkOptIn: true,
          requireApproval: true,
          template: "visit-complete",
          message: "Thanks for your time today! {{consultant.name}} is preparing your detailed quote. You'll receive it within 24 hours."
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "Quote Completion Reminder",
    description: "Reminds consultant if quote not started after visit",
    isActive: true,
    priority: 6,
    trigger: {
      type: "time-based",
      entityType: "project",
      config: {
        delayHours: 12,
        fromEvent: "stage-entered",
        stageId: STAGES.VISIT_DONE
      }
    },
    conditions: [
      {
        type: "stage-equals",
        field: "project.stage",
        operator: "equals",
        value: STAGES.VISIT_DONE
      }
    ],
    actions: [
      {
        type: "push-notification",
        config: {
          recipientType: "assigned-user",
          template: {
            title: "⏰ Quote Reminder",
            body: "Quote for {{contact.name}} due in 12 hours",
            priority: 7
          }
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  // ============= STAGE: QUOTING =============
  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "Auto-Move to Quoting",
    description: "Moves to quoting when quote is started",
    isActive: true,
    priority: 10,
    trigger: {
      type: "quote-created",
      entityType: "quote"
    },
    conditions: [
      {
        type: "stage-equals",
        field: "project.stage",
        operator: "equals",
        value: STAGES.VISIT_DONE
      }
    ],
    actions: [
      {
        type: "move-to-stage",
        config: {
          pipelineId: PIPELINE_ID,
          stageId: STAGES.QUOTING
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  // ============= STAGE: QUOTE SENT =============
  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "Estimate Sent Notification",
    description: "Notifies customer when estimate is ready",
    isActive: true,
    priority: 10,
    trigger: {
      type: "quote-published",
      entityType: "quote"
    },
    conditions: [],
    actions: [
      {
        type: "move-to-stage",
        config: {
          pipelineId: PIPELINE_ID,
          stageId: STAGES.QUOTE_SENT
        }
      },
      {
        type: "send-sms",
        config: {
          recipient: "contact",
          checkOptIn: true,
          requireApproval: true,
          template: "quote-ready",
          message: "Your {{project.serviceType}} quote is ready!\n\nTotal: ${{quote.total}}\nValid until: {{quote.expiryDate}}\n\nView here: {{quote.publicLink}}"
        }
      },
      {
        type: "send-email",
        config: {
          recipient: "contact",
          template: "quote-delivery",
          attachPDF: true,
          enableTracking: true
        }
      },
      {
        type: "update-ably",
        config: {
          channel: "location:{{location._id}}:quotes",
          event: "quote.sent",
          data: {
            quote: "{{quote}}",
            project: "{{project}}"
          }
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "Quote Follow-up Day 3",
    description: "Follow up if quote not viewed after 3 days",
    isActive: true,
    priority: 7,
    trigger: {
      type: "time-based",
      entityType: "quote",
      config: {
        delayDays: 3,
        fromEvent: "quote-sent"
      }
    },
    conditions: [
      {
        type: "stage-equals",
        field: "project.stage",
        operator: "equals",
        value: STAGES.QUOTE_SENT
      }
    ],
    actions: [
      {
        type: "send-sms",
        config: {
          recipient: "contact",
          checkOptIn: true,
          requireApproval: true,
          template: "quote-followup-3d",
          message: "Hi {{contact.firstName}}, just checking you received your {{project.serviceType}} quote. Having trouble viewing it? I can help! - {{consultant.name}}"
        }
      },
      {
        type: "create-task",
        config: {
          title: "Follow up: {{contact.name}} quote",
          assignTo: "{{project.assignedUserId}}",
          priority: "medium"
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "Quote Follow-up Day 7",
    description: "Follow up after 7 days",
    isActive: true,
    priority: 7,
    trigger: {
      type: "time-based",
      entityType: "quote",
      config: {
        delayDays: 7,
        fromEvent: "quote-sent"
      }
    },
    conditions: [
      {
        type: "stage-in",
        field: "project.stage",
        operator: "in",
        value: [STAGES.QUOTE_SENT, STAGES.VIEWED]
      }
    ],
    actions: [
      {
        type: "send-sms",
        config: {
          recipient: "contact",
          checkOptIn: true,
          requireApproval: true,
          template: "quote-followup-7d",
          message: "Hi {{contact.firstName}}, any questions about your {{project.serviceType}} quote? I'm happy to discuss options or adjust the scope. - {{consultant.name}}"
        }
      },
      {
        type: "send-email",
        config: {
          recipient: "contact",
          template: "quote-followup-7d",
          requireApproval: true
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "Quote Follow-up Day 14",
    description: "Two week follow-up with special offer",
    isActive: true,
    priority: 6,
    trigger: {
      type: "time-based",
      entityType: "quote",
      config: {
        delayDays: 14,
        fromEvent: "quote-sent"
      }
    },
    conditions: [
      {
        type: "stage-in",
        field: "project.stage",
        operator: "in",
        value: [STAGES.QUOTE_SENT, STAGES.VIEWED]
      }
    ],
    actions: [
      {
        type: "send-email",
        config: {
          recipient: "contact",
          template: "quote-followup-14d",
          requireApproval: true,
          subject: "Special offer on your {{project.serviceType}} quote"
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "Quote Expiring Soon",
    description: "Warning 5 days before quote expires",
    isActive: true,
    priority: 8,
    trigger: {
      type: "time-based",
      entityType: "quote",
      config: {
        delayDays: -5,
        fromEvent: "quote-expiry"
      }
    },
    conditions: [
      {
        type: "stage-in",
        field: "project.stage",
        operator: "in",
        value: [STAGES.QUOTE_SENT, STAGES.VIEWED]
      }
    ],
    actions: [
      {
        type: "send-sms",
        config: {
          recipient: "contact",
          checkOptIn: true,
          requireApproval: false,
          template: "quote-expiring",
          message: "⏰ Your quote expires in 5 days! Current price of ${{quote.total}} is locked in until {{quote.expiryDate}}. After that, prices may increase."
        }
      },
      {
        type: "push-notification",
        config: {
          recipientType: "assigned-user",
          template: {
            title: "Quote Expiring Soon",
            body: "{{contact.name}}'s quote expires in 5 days"
          }
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  // ============= STAGE: VIEWED =============
  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "Hot Lead Alert - Quote Viewed",
    description: "Instantly notifies consultant when quote is viewed",
    isActive: true,
    priority: 10,
    trigger: {
      type: "quote-viewed",
      entityType: "quote"
    },
    conditions: [
      {
        type: "stage-equals",
        field: "project.stage",
        operator: "equals",
        value: STAGES.QUOTE_SENT
      }
    ],
    actions: [
      {
        type: "move-to-stage",
        config: {
          pipelineId: PIPELINE_ID,
          stageId: STAGES.VIEWED
        }
      },
      {
        type: "push-notification",
        config: {
          recipientType: "assigned-user",
          urgent: true,
          template: {
            title: "🔥 HOT LEAD - Viewing Quote NOW!",
            body: "{{contact.name}} is looking at their ${{quote.total}} quote",
            priority: 10,
            ttl: 300,
            data: {
              type: "hot-lead",
              projectId: "{{project._id}}",
              contactPhone: "{{contact.phone}}"
            }
          }
        }
      },
      {
        type: "create-task",
        config: {
          title: "🔥 CALL NOW: {{contact.name}} viewing quote",
          assignTo: "{{project.assignedUserId}}",
          dueInMinutes: 30,
          priority: "critical",
          autoCall: true
        }
      },
      {
        type: "update-ably",
        config: {
          channel: "quote:{{quote._id}}:presence",
          event: "customer.viewing",
          presence: true,
          data: {
            customerId: "{{contact._id}}",
            customerName: "{{contact.name}}",
            viewingStarted: "{{timestamp}}"
          }
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "Viewing Follow-up",
    description: "Follow up 1 hour after customer views quote",
    isActive: true,
    priority: 7,
    trigger: {
      type: "time-based",
      entityType: "quote",
      config: {
        delayMinutes: 60,
        fromEvent: "quote-viewed"
      }
    },
    conditions: [
      {
        type: "stage-equals",
        field: "project.stage",
        operator: "equals",
        value: STAGES.VIEWED
      }
    ],
    actions: [
      {
        type: "send-sms",
        config: {
          recipient: "contact",
          checkOptIn: true,
          requireApproval: true,
          template: "viewing-followup",
          message: "I see you've had a chance to review the quote. I'm available now if you have any questions! - {{consultant.name}}"
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  // ============= STAGE: ACCEPTED =============
  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "Quote Accepted Celebration",
    description: "Celebrates when quote is accepted",
    isActive: true,
    priority: 10,
    trigger: {
      type: "stage-entered",
      entityType: "project",
      stageId: STAGES.ACCEPTED,
      pipelineId: PIPELINE_ID
    },
    conditions: [],
    actions: [
      {
        type: "push-notification",
        config: {
          recipientType: "assigned-user",
          template: {
            title: "🎉 Quote Accepted!",
            body: "{{contact.name}} accepted ${{quote.total}}",
            sound: "celebration.wav",
            priority: 10
          }
        }
      },
      {
        type: "update-ably",
        config: {
          channel: "location:{{location._id}}:team",
          event: "quote.accepted",
          data: {
            consultant: "{{consultant.name}}",
            amount: "{{quote.total}}",
            customerName: "{{contact.name}}"
          }
        }
      },
      {
        type: "send-sms",
        config: {
          recipient: "contact",
          checkOptIn: true,
          requireApproval: false,
          template: "quote-accepted",
          message: "🎉 Wonderful! We're excited to work with you. Contract coming shortly for signature."
        }
      },
      {
        type: "generate-contract",
        config: {
          template: "standard-contract",
          includeQuote: true,
          includeTerms: true
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  // ============= STAGE: SIGNED =============
  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "Contract Signed Process",
    description: "Handles contract signature and deposit request",
    isActive: true,
    priority: 10,
    trigger: {
      type: "stage-entered",
      entityType: "project",
      stageId: STAGES.SIGNED,
      pipelineId: PIPELINE_ID
    },
    conditions: [],
    actions: [
      {
        type: "send-email",
        config: {
          recipient: "contact",
          template: "contract-executed",
          attachments: ["signed-contract"],
          subject: "Your signed contract - {{company.name}}"
        }
      },
      {
        type: "send-sms",
        config: {
          recipient: "contact",
          checkOptIn: true,
          requireApproval: true,
          template: "deposit-request",
          message: "To secure your project start date, please submit your deposit: {{payment.link}}"
        }
      },
      {
        type: "create-task",
        config: {
          title: "Collect deposit from {{contact.name}}",
          assignTo: "{{project.assignedUserId}}",
          priority: "high",
          dueInDays: 3
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  // ============= STAGE: DEPOSIT =============
  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "Deposit Received Transition",
    description: "Transitions to active job after deposit",
    isActive: true,
    priority: 10,
    trigger: {
      type: "payment-received",
      entityType: "payment",
      config: {
        paymentType: "deposit"
      }
    },
    conditions: [
      {
        type: "stage-equals",
        field: "project.stage",
        operator: "equals",
        value: STAGES.SIGNED
      }
    ],
    actions: [
      {
        type: "move-to-stage",
        config: {
          pipelineId: PIPELINE_ID,
          stageId: STAGES.DEPOSIT
        }
      },
      {
        type: "send-sms",
        config: {
          recipient: "contact",
          checkOptIn: true,
          requireApproval: false,
          template: "deposit-received",
          message: "✅ Deposit received! Thank you. Your project is officially scheduled. We'll contact you soon with start date details."
        }
      },
      {
        type: "transition-pipeline",
        config: {
          toPipelineId: "active-jobs",
          toStageId: "pending-scheduling"
        }
      },
      {
        type: "create-task",
        config: {
          title: "Schedule project: {{contact.name}}",
          assignTo: "{{location.schedulerId}}",
          priority: "high",
          projectId: "{{project._id}}"
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  // ============= SMS KEYWORD HANDLER =============
  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "SMS Keyword Router",
    description: "Handles customer SMS responses with keywords",
    isActive: true,
    priority: 10,
    trigger: {
      type: "sms-received",
      entityType: "message"
    },
    conditions: [],
    actions: [
      {
        type: "keyword-router",
        config: {
          keywords: {
            "R|RESCHEDULE": "reschedule-flow",
            "C|CONFIRM": "confirm-appointment",
            "YES|ACCEPT|APPROVED": "accept-quote",
            "NO|DECLINE": "decline-quote",
            "PAY|PAYMENT": "send-payment-link",
            "STOP": "opt-out",
            "START": "opt-in",
            "?|HELP": "send-help-menu"
          },
          defaultAction: "forward-to-consultant"
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  // ============= ADDITIONAL AUTOMATIONS =============
  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "Daily Morning Brief",
    description: "Sends daily summary to consultants",
    isActive: true,
    priority: 5,
    trigger: {
      type: "recurring-schedule",
      config: {
        frequency: "daily",
        hour: 8,
        timezone: "{{location.timezone}}"
      }
    },
    conditions: [],
    actions: [
      {
        type: "send-daily-brief",
        config: {
          recipientType: "all-consultants",
          includeStats: ["tasks-due", "appointments-today", "quotes-pending"]
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },

  {
    _id: generateId(),
    locationId: LOCATION_ID,
    pipelineId: PIPELINE_ID,
    name: "Weather Check for Appointments",
    description: "Checks weather for outdoor appointments",
    isActive: true,
    priority: 6,
    trigger: {
      type: "time-based",
      entityType: "appointment",
      config: {
        delayHours: -12,
        fromEvent: "appointment-start"
      }
    },
    conditions: [
      {
        type: "custom",
        config: {
          expression: "project.isOutdoor === true"
        }
      }
    ],
    actions: [
      {
        type: "check-weather",
        config: {
          location: "{{project.address}}",
          severity: 7
        }
      },
      {
        type: "conditional-action",
        config: {
          condition: "weather.severity > 7",
          action: {
            type: "send-sms",
            config: {
              recipient: "contact",
              message: "Weather alert: {{weather.condition}} expected tomorrow. We may need to reschedule your appointment. We'll call to confirm."
            }
          }
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

// Stage mapping for summary
const STAGE_NAMES = {
  [STAGES.CREATED]: 'Created',
  [STAGES.VISIT_SCHEDULED]: 'Visit Scheduled',
  [STAGES.VISIT_DONE]: 'Visit Done',
  [STAGES.QUOTING]: 'Quoting',
  [STAGES.QUOTE_SENT]: 'Estimate Sent',
  [STAGES.VIEWED]: 'Viewed',
  [STAGES.ACCEPTED]: 'Accepted',
  [STAGES.SIGNED]: 'Signed',
  [STAGES.DEPOSIT]: 'Deposit'
};

async function seedAutomations() {
  let client;
  
  try {
    console.log('🔄 Connecting to MongoDB...');
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    
    console.log('✅ Connected to MongoDB');
    
    const db = client.db();
    const collection = db.collection('automation_rules');
    
    // Check if automations already exist for this location/pipeline
    const existingCount = await collection.countDocuments({ 
      locationId: LOCATION_ID,
      pipelineId: PIPELINE_ID
    });
    
    if (existingCount > 0) {
      console.log(`⚠️  Found ${existingCount} existing automations for this location/pipeline`);
      const answer = await prompt('Delete existing automations and recreate? (yes/no): ');
      
      if (answer.toLowerCase() === 'yes') {
        const result = await collection.deleteMany({ 
          locationId: LOCATION_ID,
          pipelineId: PIPELINE_ID
        });
        console.log(`🗑️  Deleted ${result.deletedCount} existing automations`);
      } else {
        console.log('❌ Seeding cancelled');
        return;
      }
    }
    
    // Insert all automations
    console.log(`\n📝 Creating ${estimatesAutomations.length} automations...`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const automation of estimatesAutomations) {
      try {
        await collection.insertOne(automation);
        console.log(`✅ Created: ${automation.name}`);
        successCount++;
      } catch (error) {
        console.error(`❌ Failed to create: ${automation.name}`, error.message);
        errorCount++;
      }
    }
    
    console.log('\n🎉 Seeding completed!');
    console.log(`✅ Successfully created: ${successCount} automations`);
    if (errorCount > 0) {
      console.log(`❌ Failed: ${errorCount} automations`);
    }
    
    // Show summary by stage
    console.log('\n📋 Automations by stage:');
    
    for (const [stageId, stageName] of Object.entries(STAGE_NAMES)) {
      const count = estimatesAutomations.filter(a => 
        a.trigger.stageId === stageId || 
        a.trigger.config?.stageId === stageId ||
        (a.conditions && a.conditions.some(c => c.value === stageId))
      ).length;
      if (count > 0) {
        console.log(`   ${stageName}: ${count} automations`);
      }
    }
    
    // Other automations
    const otherCount = estimatesAutomations.filter(a => 
      !Object.keys(STAGES).some(key => 
        STAGES[key] === a.trigger.stageId || 
        STAGES[key] === a.trigger.config?.stageId
      )
    ).length;
    console.log(`   Other (SMS handler, daily brief, etc.): ${otherCount} automations`);
    
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('\n👋 MongoDB connection closed');
    }
  }
}

// Simple prompt function for user input
function prompt(question) {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise(resolve => {
    readline.question(question, answer => {
      readline.close();
      resolve(answer);
    });
  });
}

// Run the seeder
console.log('🚀 LPai Location Automations Seeder (with Stage IDs)');
console.log('====================================================\n');

seedAutomations()
  .then(() => {
    console.log('\n✅ All done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });