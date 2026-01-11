const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/lpai';
const TEMPLATE_LOCATION_ID = 'TEMPLATE';

// All automation rules for the estimates pipeline
const estimatesAutomations = [
  // ============= STAGE: CREATED =============
  {
    _id: new ObjectId(),
    locationId: TEMPLATE_LOCATION_ID,
    name: "New Lead Assignment & Notification",
    description: "Assigns consultant and sends initial acknowledgment when a new lead is created",
    isActive: true,
    isTemplate: true,
    priority: 10,
    trigger: {
      type: "stage-entered",
      entityType: "project",
      stageId: "created",
      pipelineId: "estimates"
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
    createdAt: new Date(),
    updatedAt: new Date()
  },

  {
    _id: new ObjectId(),
    locationId: TEMPLATE_LOCATION_ID,
    name: "Lead Response Overdue Warning",
    description: "Alerts consultant when 1 hour left to contact lead",
    isActive: true,
    isTemplate: true,
    priority: 8,
    trigger: {
      type: "time-based",
      entityType: "project",
      config: {
        delayMinutes: 60,
        fromEvent: "stage-entered",
        stageId: "created"
      }
    },
    conditions: [
      {
        type: "stage-equals",
        field: "stage",
        operator: "equals",
        value: "created"
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
    createdAt: new Date(),
    updatedAt: new Date()
  },

  {
    _id: new ObjectId(),
    locationId: TEMPLATE_LOCATION_ID,
    name: "Lead Response Overdue Escalation",
    description: "Escalates to manager after 2 hours without response",
    isActive: true,
    isTemplate: true,
    priority: 10,
    trigger: {
      type: "time-based",
      entityType: "project",
      config: {
        delayMinutes: 120,
        fromEvent: "stage-entered",
        stageId: "created"
      }
    },
    conditions: [
      {
        type: "stage-equals",
        field: "stage",
        operator: "equals",
        value: "created"
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
    createdAt: new Date(),
    updatedAt: new Date()
  },

  // ============= STAGE: VISIT SCHEDULED =============
  {
    _id: new ObjectId(),
    locationId: TEMPLATE_LOCATION_ID,
    name: "Appointment Scheduled Confirmation",
    description: "Sends confirmations when estimate appointment is booked",
    isActive: true,
    isTemplate: true,
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
          pipelineId: "estimates",
          stageId: "visit-scheduled"
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
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date(),
    updatedAt: new Date()
  },

  {
    _id: new ObjectId(),
    locationId: TEMPLATE_LOCATION_ID,
    name: "24-Hour Appointment Reminder",
    description: "Reminds customer and consultant day before appointment",
    isActive: true,
    isTemplate: true,
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
        value: "visit-scheduled"
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
    createdAt: new Date(),
    updatedAt: new Date()
  },

  {
    _id: new ObjectId(),
    locationId: TEMPLATE_LOCATION_ID,
    name: "2-Hour Appointment Reminder",
    description: "Final reminder 2 hours before appointment",
    isActive: true,
    isTemplate: true,
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
        value: "visit-scheduled"
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
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date(),
    updatedAt: new Date()
  },

  // ============= STAGE: VISIT DONE =============
  {
    _id: new ObjectId(),
    locationId: TEMPLATE_LOCATION_ID,
    name: "Auto-Move to Visit Done",
    description: "Automatically moves to Visit Done after appointment time",
    isActive: true,
    isTemplate: true,
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
        value: "visit-scheduled"
      }
    ],
    actions: [
      {
        type: "move-to-stage",
        config: {
          pipelineId: "estimates",
          stageId: "visit-done"
        }
      },
      {
        type: "create-task",
        config: {
          title: "Complete quote for {{contact.name}}",
          assignTo: "{{project.assignedUserId}}",
          dueInHours: "{{location.quoteCompletionHours}}",
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
    createdAt: new Date(),
    updatedAt: new Date()
  },

  {
    _id: new ObjectId(),
    locationId: TEMPLATE_LOCATION_ID,
    name: "Visit Complete Thank You",
    description: "Thanks customer after estimate visit",
    isActive: true,
    isTemplate: true,
    priority: 7,
    trigger: {
      type: "stage-entered",
      entityType: "project",
      stageId: "visit-done"
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
          message: "Thanks for your time today! {{consultant.name}} is preparing your detailed quote. You'll receive it within {{location.quoteCompletionHours}} hours."
        }
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date(),
    updatedAt: new Date()
  },

  // ============= STAGE: QUOTE SENT =============
  {
    _id: new ObjectId(),
    locationId: TEMPLATE_LOCATION_ID,
    name: "Estimate Sent Notification",
    description: "Notifies customer when estimate is ready",
    isActive: true,
    isTemplate: true,
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
          pipelineId: "estimates",
          stageId: "quote-sent"
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
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date(),
    updatedAt: new Date()
  },

  {
    _id: new ObjectId(),
    locationId: TEMPLATE_LOCATION_ID,
    name: "Quote Follow-up Day 3",
    description: "Follow up if quote not viewed after 3 days",
    isActive: true,
    isTemplate: true,
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
        value: "quote-sent"
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
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date(),
    updatedAt: new Date()
  },

  {
    _id: new ObjectId(),
    locationId: TEMPLATE_LOCATION_ID,
    name: "Quote Follow-up Day 7",
    description: "Follow up after 7 days",
    isActive: true,
    isTemplate: true,
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
        value: ["quote-sent", "viewed"]
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
    createdAt: new Date(),
    updatedAt: new Date()
  },

  {
    _id: new ObjectId(),
    locationId: TEMPLATE_LOCATION_ID,
    name: "Quote Expiring Soon",
    description: "Warning 5 days before quote expires",
    isActive: true,
    isTemplate: true,
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
        value: ["quote-sent", "viewed"]
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
      }
    ],
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdBy: "system",
    createdAt: new Date(),
    updatedAt: new Date()
  },

  // ============= STAGE: VIEWED =============
  {
    _id: new ObjectId(),
    locationId: TEMPLATE_LOCATION_ID,
    name: "Hot Lead Alert - Quote Viewed",
    description: "Instantly notifies consultant when quote is viewed",
    isActive: true,
    isTemplate: true,
    priority: 10,
    trigger: {
      type: "quote-viewed",
      entityType: "quote"
    },
    conditions: [
      {
        type: "custom",
        config: {
          expression: "project.stage === 'quote-sent' && location.enableHotLeadAlerts === true"
        }
      }
    ],
    actions: [
      {
        type: "move-to-stage",
        config: {
          pipelineId: "estimates",
          stageId: "viewed"
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
    createdAt: new Date(),
    updatedAt: new Date()
  },

  {
    _id: new ObjectId(),
    locationId: TEMPLATE_LOCATION_ID,
    name: "Viewing Follow-up",
    description: "Follow up 1 hour after customer views quote",
    isActive: true,
    isTemplate: true,
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
        value: "viewed"
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
    createdAt: new Date(),
    updatedAt: new Date()
  },

  // ============= SMS KEYWORD HANDLER =============
  {
    _id: new ObjectId(),
    locationId: TEMPLATE_LOCATION_ID,
    name: "SMS Keyword Router",
    description: "Handles customer SMS responses with keywords",
    isActive: true,
    isTemplate: true,
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
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

async function seedAutomations() {
  let client;
  
  try {
    console.log('🔄 Connecting to MongoDB...');
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    
    console.log('✅ Connected to MongoDB');
    
    const db = client.db();
    const collection = db.collection('automation_rules');
    
    // Check if templates already exist
    const existingCount = await collection.countDocuments({ 
      locationId: TEMPLATE_LOCATION_ID,
      isTemplate: true 
    });
    
    if (existingCount > 0) {
      console.log(`⚠️  Found ${existingCount} existing template automations`);
      const answer = await prompt('Delete existing templates and recreate? (yes/no): ');
      
      if (answer.toLowerCase() === 'yes') {
        const result = await collection.deleteMany({ 
          locationId: TEMPLATE_LOCATION_ID,
          isTemplate: true 
        });
        console.log(`🗑️  Deleted ${result.deletedCount} existing templates`);
      } else {
        console.log('❌ Seeding cancelled');
        return;
      }
    }
    
    // Insert all automations
    console.log(`\n📝 Creating ${estimatesAutomations.length} automation templates...`);
    
    for (const automation of estimatesAutomations) {
      try {
        await collection.insertOne(automation);
        console.log(`✅ Created: ${automation.name}`);
      } catch (error) {
        console.error(`❌ Failed to create: ${automation.name}`, error.message);
      }
    }
    
    console.log('\n🎉 Seeding completed successfully!');
    console.log(`📊 Total automations created: ${estimatesAutomations.length}`);
    
    // Show summary by stage
    console.log('\n📋 Automations by stage:');
    const stages = ['created', 'visit-scheduled', 'visit-done', 'quote-sent', 'viewed'];
    
    for (const stage of stages) {
      const count = estimatesAutomations.filter(a => 
        a.trigger.stageId === stage || 
        a.trigger.config?.stageId === stage
      ).length;
      console.log(`   ${stage}: ${count} automations`);
    }
    
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
console.log('🚀 LPai Estimates Pipeline Automation Seeder');
console.log('=========================================\n');

seedAutomations()
  .then(() => {
    console.log('\n✅ All done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });