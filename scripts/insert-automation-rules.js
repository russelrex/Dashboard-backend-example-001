// scripts/insert-automation-rules.js
// Script to insert automation rules for the pipeline workflow

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://mobileApp:A602ZiVx1ZrZpACw@leadprospectcluster.ujmqx.mongodb.net/lpai?retryWrites=true&w=majority';

async function insertAutomationRules() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db('lpai');
    const collection = db.collection('automation_rules');
    
    // Check if rules already exist
    const existingRules = await collection.find({
      $or: [
        { name: "Contract Signed - Move to Deposit" },
        { name: "Deposit Received - Transition to Active Jobs" }
      ]
    }).toArray();
    
    if (existingRules.length > 0) {
      console.log('Automation rules already exist, skipping insertion');
      console.log('Existing rules:', existingRules.map(r => r.name));
      return;
    }
    
    const automationRules = [
      {
        locationId: "5OuaTrizW5wkZMI1xtvX",
        name: "Contract Signed - Move to Deposit",
        description: "When contract is signed, move to deposit stage",
        isActive: true,
        priority: 10,
        trigger: {
          type: "stage-entered",
          stageId: "b48699ce-5a88-4ecd-a2e0-aec07219bc22", // Signed stage
          pipelineId: "9cGrqJIQlofiY1Ehj8xf"
        },
        actions: [
          {
            type: "send-sms",
            config: {
              recipient: "contact",
              message: "Contract signed! Please submit your deposit to secure your project start date."
            }
          },
          {
            type: "create-task",
            config: {
              taskTitle: "Collect deposit from {{contact.name}}",
              assignee: "assigned",
              priority: "high",
              dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // 3 days from now
            }
          }
        ],
        executionStats: {
          executionCount: 0,
          successCount: 0,
          failureCount: 0,
          lastExecuted: null
        },
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        locationId: "5OuaTrizW5wkZMI1xtvX",
        name: "Deposit Received - Transition to Active Jobs",
        description: "When deposit is received, move to active jobs pipeline",
        isActive: true,
        priority: 10,
        trigger: {
          type: "stage-entered",
          stageId: "0a3414cd-bc81-43fa-9b4b-f98906995f99", // Deposit stage
          pipelineId: "9cGrqJIQlofiY1Ehj8xf"
        },
        actions: [
          {
            type: "transition-pipeline",
            config: {
              toPipelineId: "aaSTiFRrEPvGYXR9uw85", // Active Jobs pipeline
              toStageId: "dd64488d-9d19-4d8a-9e05-54e0a80b4c09" // Pending Scheduling
            }
          },
          {
            type: "send-sms",
            config: {
              recipient: "contact",
              message: "Deposit received! Your project is now scheduled. We'll contact you soon with start date."
            }
          },
          {
            type: "create-task",
            config: {
              taskTitle: "Schedule project: {{contact.name}}",
              assignee: "specific",
              specificUserId: "{{location.schedulerId}}",
              priority: "high"
            }
          }
        ],
        executionStats: {
          executionCount: 0,
          successCount: 0,
          failureCount: 0,
          lastExecuted: null
        },
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];
    
    const result = await collection.insertMany(automationRules);
    console.log(`Successfully inserted ${result.insertedCount} automation rules`);
    console.log('Inserted rule IDs:', result.insertedIds);
    
    // Verify insertion
    const insertedRules = await collection.find({
      _id: { $in: Object.values(result.insertedIds) }
    }).toArray();
    
    console.log('\nInserted rules:');
    insertedRules.forEach(rule => {
      console.log(`- ${rule.name}: ${rule.description}`);
      console.log(`  Trigger: ${rule.trigger.type} -> ${rule.trigger.stageId}`);
      console.log(`  Actions: ${rule.actions.length} actions`);
    });
    
  } catch (error) {
    console.error('Error inserting automation rules:', error);
  } finally {
    await client.close();
    console.log('Disconnected from MongoDB');
  }
}

// Run the script
if (require.main === module) {
  insertAutomationRules()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { insertAutomationRules };
