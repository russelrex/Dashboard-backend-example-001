// scripts/seed-automation-templates.js
const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://mobileApp:A602ZiVx1ZrZpACw@leadprospectcluster.ujmqx.mongodb.net/lpai?retryWrites=true&w=majority';

const sampleTemplates = [
  {
    locationId: 'TEMPLATE',
    isTemplate: true,
    name: 'Welcome SMS',
    description: 'Send welcome SMS when job enters first stage',
    trigger: {
      type: 'enter-stage',
      stageId: 'created',
      config: {}
    },
    actions: [
      {
        type: 'send-sms',
        config: {
          message: 'Welcome! We\'re excited to work with you on your project.',
          from: 'location'
        }
      }
    ],
    priority: 0,
    isActive: true,
    createdBy: 'system',
    createdAt: new Date(),
    updatedAt: new Date(),
    executionStats: {
      executionCount: 0,
      successCount: 0,
      failureCount: 0
    }
  },
  {
    locationId: 'TEMPLATE',
    isTemplate: true,
    name: 'Schedule Reminder',
    description: 'Send reminder SMS before scheduled visit',
    trigger: {
      type: 'stage-delay',
      stageId: 'visit-scheduled',
      config: {
        delayAmount: 1,
        delayUnit: 'days'
      }
    },
    actions: [
      {
        type: 'send-sms',
        config: {
          message: 'Reminder: Your visit is scheduled for tomorrow. We\'ll see you soon!',
          from: 'location'
        }
      }
    ],
    priority: 0,
    isActive: true,
    createdBy: 'system',
    createdAt: new Date(),
    updatedAt: new Date(),
    executionStats: {
      executionCount: 0,
      successCount: 0,
      failureCount: 0
    }
  },
  {
    locationId: 'TEMPLATE',
    isTemplate: true,
    name: 'Quote Follow-up',
    description: 'Send follow-up email when quote is viewed',
    trigger: {
      type: 'quote-viewed',
      stageId: 'quote-sent',
      config: {}
    },
    actions: [
      {
        type: 'send-email',
        config: {
          subject: 'Your Quote - Any Questions?',
          message: 'We noticed you viewed your quote. Do you have any questions? We\'re here to help!',
          from: 'location'
        }
      }
    ],
    priority: 0,
    isActive: true,
    createdBy: 'system',
    createdAt: new Date(),
    updatedAt: new Date(),
    executionStats: {
      executionCount: 0,
      successCount: 0,
      failureCount: 0
    }
  },
  {
    locationId: 'TEMPLATE',
    isTemplate: true,
    name: 'Team Notification',
    description: 'Notify team when job is accepted',
    trigger: {
      type: 'enter-stage',
      stageId: 'accepted',
      config: {}
    },
    actions: [
      {
        type: 'team-notification',
        config: {
          message: 'New job accepted! 🎉',
          recipients: ['assigned_user']
        }
      }
    ],
    priority: 0,
    isActive: true,
    createdBy: 'system',
    createdAt: new Date(),
    updatedAt: new Date(),
    executionStats: {
      executionCount: 0,
      successCount: 0,
      failureCount: 0
    }
  },
  {
    locationId: 'TEMPLATE',
    isTemplate: true,
    name: 'Payment Reminder',
    description: 'Send payment reminder after job completion',
    trigger: {
      type: 'stage-delay',
      stageId: 'completed',
      config: {
        delayAmount: 3,
        delayUnit: 'days'
      }
    },
    actions: [
      {
        type: 'send-email',
        config: {
          subject: 'Payment Reminder',
          message: 'Thank you for choosing us! Please complete your payment to finalize the project.',
          from: 'location'
        }
      }
    ],
    priority: 0,
    isActive: true,
    createdBy: 'system',
    createdAt: new Date(),
    updatedAt: new Date(),
    executionStats: {
      executionCount: 0,
      successCount: 0,
      failureCount: 0
    }
  }
];

async function seedTemplates() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db();
    
    console.log('Seeding automation templates...');
    
    // Clear existing templates
    await db.collection('automation_rules').deleteMany({ 
      locationId: 'TEMPLATE', 
      isTemplate: true 
    });
    
    // Insert new templates
    const result = await db.collection('automation_rules').insertMany(sampleTemplates);
    
    console.log(`✅ Successfully seeded ${result.insertedCount} automation templates!`);
    console.log('Templates created:');
    sampleTemplates.forEach((template, index) => {
      console.log(`${index + 1}. ${template.name} - ${template.description}`);
    });
    
  } catch (error) {
    console.error('❌ Error seeding templates:', error);
  } finally {
    await client.close();
  }
}

seedTemplates(); 