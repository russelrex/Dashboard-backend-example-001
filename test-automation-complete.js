#!/usr/bin/env node

/**
 * Complete Automation Test Script
 * Tests the automation flow directly without API layer
 */

require('dotenv').config({ path: '.env.local' });
const { MongoClient, ObjectId } = require('mongodb');
const crypto = require('crypto');

// Test configuration
const TEST_CONFIG = {
  contactId: '68af87f51ed950208707fec8',
  locationId: '5OuaTrizW5wkZMI1xtvX',
  userId: 'UflDPM1zkSDhrgJUBjZm',
  assignedTo: '68564ce27eb5e1b3a7f2e149',
  pipelineId: '9cGrqJIQlofiY1Ehj8xf',
  pipelineName: 'Estimates'
};

class AutomationTestRunner {
  constructor() {
    this.db = null;
    this.client = null;
    this.testProjectId = null;
    this.testRuleId = null;
  }

  async connect() {
    try {
      console.log('🔌 Connecting to MongoDB...');
      const mongoUri = process.env.MONGODB_URI;
      if (!mongoUri) {
        throw new Error('MONGODB_URI not found in .env.local');
      }
      
      this.client = new MongoClient(mongoUri);
      await this.client.connect();
      this.db = this.client.db();
      console.log('✅ MongoDB connected successfully');
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error);
      throw error;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      console.log('🔌 MongoDB disconnected');
    }
  }

  async createTestProject() {
    try {
      console.log('\n📋 Creating test project...');
      
      const projectData = {
        title: 'Automation Test Project',
        contactId: new ObjectId(TEST_CONFIG.contactId),
        userId: TEST_CONFIG.userId,
        locationId: TEST_CONFIG.locationId,
        assignedTo: TEST_CONFIG.assignedTo,
        status: 'open',
        monetaryValue: 5000,
        pipelineId: TEST_CONFIG.pipelineId,
        pipelineName: TEST_CONFIG.pipelineName,
        createdAt: new Date(),
        updatedAt: new Date(),
        source: 'test-script'
      };

      const result = await this.db.collection('projects').insertOne(projectData);
      this.testProjectId = result.insertedId;
      
      console.log('✅ Test project created:', {
        id: this.testProjectId.toString(),
        title: projectData.title,
        assignedTo: projectData.assignedTo
      });

      return projectData;
    } catch (error) {
      console.error('❌ Failed to create test project:', error);
      throw error;
    }
  }

  async createTestAutomationRule() {
    try {
      console.log('\n⚙️ Creating test automation rule...');
      
      const ruleData = {
        name: 'Test Automation Rule',
        locationId: TEST_CONFIG.locationId,
        isActive: true,
        priority: 1,
        trigger: {
          type: 'project-created',
          conditions: []
        },
        actions: [
          {
            type: 'push-notification',
            config: {
              recipientType: 'assigned-user',
              template: {
                title: 'New Project: {{project.title}}',
                body: 'You have been assigned to {{project.title}}',
                data: {
                  type: 'project-assigned',
                  projectId: '{{project._id}}'
                }
              }
            }
          },
          {
            type: 'create-task',
            config: {
              taskTitle: 'Review {{project.title}}',
              taskDescription: 'Review the project requirements and create a plan',
              assignee: 'assigned',
              priority: 'high',
              dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours from now
            }
          },
          {
            type: 'send-sms',
            config: {
              recipient: 'contact',
              message: 'Hi {{contact.firstName}}, your project {{project.title}} has been created and assigned.',
              templateKey: 'project-created'
            }
          },
          {
            type: 'send-email',
            config: {
              recipient: 'contact',
              subject: 'Project Created: {{project.title}}',
              body: 'Dear {{contact.firstName}},\n\nYour project {{project.title}} has been created and assigned to our team.\n\nWe will contact you soon to discuss the details.\n\nBest regards,\nThe Team'
            }
          }
        ],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await this.db.collection('automation_rules').insertOne(ruleData);
      this.testRuleId = result.insertedId;
      
      console.log('✅ Test automation rule created:', {
        id: this.testRuleId.toString(),
        name: ruleData.name,
        actions: ruleData.actions.map(a => a.type)
      });

      return ruleData;
    } catch (error) {
      console.error('❌ Failed to create test automation rule:', error);
      throw error;
    }
  }

  async cleanupTestData() {
    try {
      console.log('\n🧹 Cleaning up test data...');
      
      if (this.testProjectId) {
        await this.db.collection('projects').deleteOne({ _id: this.testProjectId });
        console.log('✅ Test project deleted');
      }
      
      if (this.testRuleId) {
        await this.db.collection('automation_rules').deleteOne({ _id: this.testRuleId });
        console.log('✅ Test automation rule deleted');
      }
      
      // Clean up any test automation queue items
      const deletedQueueItems = await this.db.collection('automation_queue').deleteMany({
        'metadata.triggerHash': { $exists: true }
      });
      console.log(`✅ Deleted ${deletedQueueItems.deletedCount} test queue items`);
      
    } catch (error) {
      console.error('❌ Cleanup failed:', error);
    }
  }

  // Direct copy of the automation event listener logic for testing
  generateTriggerHash(event, ruleId) {
    const hashData = {
      ruleId,
      eventType: event.type,
      contactId: event.data?.contactId || event.data?.contact?._id,
      locationId: event.data?.locationId,
    };
    
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(hashData))
      .digest('hex');
  }

  async queueAutomation(rule, event) {
    console.log('\n🔄 Testing queueAutomation method...');
    const triggerHash = this.generateTriggerHash(event, rule._id.toString());
    console.log('📝 Generated trigger hash:', triggerHash);
    
    // Process each action in the rule
    for (const action of rule.actions) {
      console.log(`\n--- Processing action: ${action.type} ---`);
      
      // Calculate delay first to determine deduplication window
      const delayAmount = action.config?.delay?.amount ?? 0;
      const delayUnit = action.config?.delay?.unit || 'minutes';
      
      console.log('⏰ Delay config:', { amount: delayAmount, unit: delayUnit });
      
      // Generate unique hash for this specific action
      const actionHash = crypto
        .createHash('sha256')
        .update(JSON.stringify({
          triggerHash,
          actionType: action.type,
          actionConfig: action.config,
          projectId: event.data?.projectId || event.data?.project?._id,
          timestamp: Date.now()
        }))
        .digest('hex');
      
      console.log('🔐 Generated action hash:', actionHash);
      
      // Check for duplicates with appropriate window
      const dedupeWindow = action.type === 'push-notification' && delayAmount === 0 
        ? 30 * 1000  // 30 seconds for immediate push notifications
        : 10 * 60 * 1000; // 10 minutes for other actions

      console.log('🕐 Deduplication window:', `${dedupeWindow / 1000} seconds`);

      const existingAction = await this.db.collection('automation_queue').findOne({
        'metadata.actionHash': actionHash,
        status: { $in: ['pending', 'scheduled', 'processing'] },
        createdAt: { $gte: new Date(Date.now() - dedupeWindow) }
      });
      
      if (existingAction) {
        console.log(`⚠️ Duplicate action detected, skipping: ${action.type} - ${actionHash}`);
        continue;
      }
      
      console.log('✅ No duplicate found, creating queue entry...');
      
      // Now create the queue entry
      const queueEntry = {
        ruleId: rule._id.toString(),
        action,
        actionType: action.type,
        trigger: {
          type: event.type,
          locationId: rule.locationId,
          data: event.data
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
        console.log('⏰ Scheduled for:', queueEntry.scheduledFor);
      } else {
        queueEntry.status = 'pending';
        queueEntry.scheduledFor = new Date();
        console.log('⚡ Immediate execution');
      }

      const insertResult = await this.db.collection('automation_queue').insertOne(queueEntry);
      console.log(`✅ Queue entry created with ID: ${insertResult.insertedId}`);
    }
  }

  async testAutomationFlow() {
    try {
      console.log('\n🚀 Starting automation flow test...');
      
      // Create test data
      const project = await this.createTestProject();
      const rule = await this.createTestAutomationRule();
      
      // Create test event
      const testEvent = {
        type: 'project-created',
        data: {
          projectId: this.testProjectId.toString(),
          contactId: TEST_CONFIG.contactId,
          locationId: TEST_CONFIG.locationId,
          project: {
            _id: this.testProjectId.toString(),
            title: project.title,
            assignedTo: project.assignedTo
          },
          contact: {
            _id: TEST_CONFIG.contactId,
            firstName: 'Test',
            lastName: 'User'
          }
        }
      };
      
      console.log('\n📡 Test event created:', JSON.stringify(testEvent, null, 2));
      
      // Test the automation queue method directly
      await this.queueAutomation(rule, testEvent);
      
      // Check results
      await this.checkAutomationQueue();
      
    } catch (error) {
      console.error('❌ Automation flow test failed:', error);
    }
  }

  async checkAutomationQueue() {
    try {
      console.log('\n🔍 Checking automation queue results...');
      
      const queueItems = await this.db.collection('automation_queue')
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
      
      console.log(`\n📊 Found ${queueItems.length} items in automation queue:`);
      
      const expectedActions = ['push-notification', 'create-task', 'send-sms', 'send-email'];
      const foundActions = queueItems.map(item => item.actionType);
      
      console.log('\n📋 Expected actions:', expectedActions);
      console.log('✅ Found actions:', foundActions);
      
      // Check what's missing
      const missingActions = expectedActions.filter(action => !foundActions.includes(action));
      if (missingActions.length > 0) {
        console.log('❌ Missing actions:', missingActions);
      } else {
        console.log('🎉 All expected actions found!');
      }
      
      // Show detailed queue items
      console.log('\n📝 Queue item details:');
      queueItems.forEach((item, index) => {
        console.log(`\n${index + 1}. ${item.actionType}:`);
        console.log(`   ID: ${item._id}`);
        console.log(`   Status: ${item.status}`);
        console.log(`   Scheduled: ${item.scheduledFor}`);
        console.log(`   Created: ${item.createdAt}`);
        console.log(`   Action Hash: ${item.metadata?.actionHash}`);
        console.log(`   Trigger Hash: ${item.metadata?.triggerHash}`);
      });
      
      // Check for any errors or issues
      const pendingItems = queueItems.filter(item => item.status === 'pending');
      const scheduledItems = queueItems.filter(item => item.status === 'scheduled');
      
      console.log(`\n📈 Summary:`);
      console.log(`   Total items: ${queueItems.length}`);
      console.log(`   Pending: ${pendingItems.length}`);
      console.log(`   Scheduled: ${scheduledItems.length}`);
      
    } catch (error) {
      console.error('❌ Failed to check automation queue:', error);
    }
  }

  async run() {
    try {
      console.log('🧪 Starting Complete Automation Test...');
      console.log('=====================================');
      
      await this.connect();
      await this.testAutomationFlow();
      
    } catch (error) {
      console.error('❌ Test failed:', error);
    } finally {
      await this.cleanupTestData();
      await this.disconnect();
      console.log('\n🏁 Test completed');
    }
  }
}

// Run the test
if (require.main === module) {
  const runner = new AutomationTestRunner();
  runner.run().catch(console.error);
}

module.exports = AutomationTestRunner;
