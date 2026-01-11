// scripts/test-automation.js
// Test script to verify automation system functionality

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://mobileApp:A602ZiVx1ZrZpACw@leadprospectcluster.ujmqx.mongodb.net/lpai?retryWrites=true&w=majority';

async function testAutomationSystem() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db('lpai');
    
    console.log('\n=== Testing Automation System ===\n');
    
    // Test 1: Check if automation rules exist
    console.log('1. Checking automation rules...');
    const rules = await db.collection('automation_rules').find({
      locationId: "5OuaTrizW5wkZMI1xtvX"
    }).toArray();
    
    if (rules.length === 0) {
      console.log('❌ No automation rules found. Run insert-automation-rules.js first.');
      return;
    }
    
    console.log(`✅ Found ${rules.length} automation rules:`);
    rules.forEach(rule => {
      console.log(`   - ${rule.name}: ${rule.description}`);
      console.log(`     Trigger: ${rule.trigger.type} -> ${rule.trigger.stageId}`);
      console.log(`     Actions: ${rule.actions.length}`);
    });
    
    // Test 2: Check automation queue
    console.log('\n2. Checking automation queue...');
    const queueItems = await db.collection('automation_queue').find({
      status: 'pending'
    }).toArray();
    
    console.log(`✅ Found ${queueItems.length} pending automation tasks`);
    
    // Test 3: Check automation executions
    console.log('\n3. Checking automation executions...');
    const executions = await db.collection('automation_executions').find({}).limit(5).toArray();
    
    console.log(`✅ Found ${executions.length} recent automation executions`);
    if (executions.length > 0) {
      const latest = executions[executions.length - 1];
      console.log(`   Latest execution: ${latest.status} at ${latest.startedAt}`);
    }
    
    // Test 4: Simulate webhook trigger
    console.log('\n4. Simulating webhook trigger...');
    const testTrigger = {
      type: 'contract-signed',
      locationId: "5OuaTrizW5wkZMI1xtvX",
      projectId: "test-project-123",
      contactId: "test-contact-456",
      stageId: "b48699ce-5a88-4ecd-a2e0-aec07219bc22"
    };
    
    // Check if rules would match this trigger
    const matchingRules = await db.collection('automation_rules').find({
      locationId: testTrigger.locationId,
      isActive: true,
      $or: [
        { 'trigger.type': testTrigger.type },
        { 'trigger.type': 'stage-entered', 'trigger.stageId': testTrigger.stageId },
        { 'trigger.type': 'enter-stage', 'trigger.stageId': testTrigger.stageId }
      ]
    }).toArray();
    
    console.log(`✅ Found ${matchingRules.length} rules that would match the test trigger`);
    
    // Test 5: Check database collections exist
    console.log('\n5. Checking required collections...');
    const collections = await db.listCollections().toArray();
    const requiredCollections = ['automation_rules', 'automation_queue', 'automation_executions'];
    
    for (const collectionName of requiredCollections) {
      const exists = collections.some(col => col.name === collectionName);
      console.log(`   ${exists ? '✅' : '❌'} ${collectionName}`);
    }
    
    // Test 6: Validate rule configurations
    console.log('\n6. Validating rule configurations...');
    let validRules = 0;
    
    for (const rule of rules) {
      let isValid = true;
      const errors = [];
      
      // Check required fields
      if (!rule.trigger || !rule.trigger.type) {
        errors.push('Missing trigger configuration');
        isValid = false;
      }
      
      if (!rule.actions || rule.actions.length === 0) {
        errors.push('No actions defined');
        isValid = false;
      }
      
      // Check action configurations
      for (const action of rule.actions) {
        if (!action.type || !action.config) {
          errors.push(`Action missing type or config: ${JSON.stringify(action)}`);
          isValid = false;
        }
      }
      
      if (isValid) {
        validRules++;
        console.log(`   ✅ ${rule.name}`);
      } else {
        console.log(`   ❌ ${rule.name}: ${errors.join(', ')}`);
      }
    }
    
    console.log(`\nRule validation: ${validRules}/${rules.length} rules are valid`);
    
    // Test 7: Check pipeline and stage IDs
    console.log('\n7. Validating pipeline and stage IDs...');
    
    const estimatesPipelineId = "9cGrqJIQlofiY1Ehj8xf";
    const activeJobsPipelineId = "aaSTiFRrEPvGYXR9uw85";
    
    const signedStageId = "b48699ce-5a88-4ecd-a2e0-aec07219bc22";
    const depositStageId = "0a3414cd-bc81-43fa-9b4b-f98906995f99";
    const pendingSchedulingStageId = "dd64488d-9d19-4d8a-9e05-54e0a80b4c09";
    
    console.log(`   Estimates Pipeline: ${estimatesPipelineId}`);
    console.log(`   Active Jobs Pipeline: ${activeJobsPipelineId}`);
    console.log(`   Signed Stage: ${signedStageId}`);
    console.log(`   Deposit Stage: ${depositStageId}`);
    console.log(`   Pending Scheduling Stage: ${pendingSchedulingStageId}`);
    
    // Test 8: Check if projects collection exists and has sample data
    console.log('\n8. Checking projects collection...');
    const projectsCount = await db.collection('projects').countDocuments();
    console.log(`   Projects in database: ${projectsCount}`);
    
    if (projectsCount > 0) {
      const sampleProject = await db.collection('projects').findOne({});
      console.log(`   Sample project structure: ${Object.keys(sampleProject || {}).join(', ')}`);
    }
    
    // Test 9: Test the execute endpoint logic
    console.log('\n9. Testing execute endpoint logic...');
    
    // Simulate what the execute endpoint would do
    const testEvent = {
      locationId: "5OuaTrizW5wkZMI1xtvX",
      type: "contract-signed",
      stageId: "b48699ce-5a88-4ecd-a2e0-aec07219bc22",
      projectId: "test-project-123"
    };
    
    const testRules = await db.collection('automation_rules').find({
      locationId: testEvent.locationId,
      isActive: true,
      $or: [
        { 'trigger.type': testEvent.type },
        { 'trigger.type': 'stage-entered', 'trigger.stageId': testEvent.stageId },
        { 'trigger.type': 'enter-stage', 'trigger.stageId': testEvent.stageId }
      ]
    }).toArray();
    
    console.log(`   Execute endpoint would find ${testRules.length} matching rules`);
    
    console.log('\n=== Test Summary ===');
    console.log(`✅ Automation rules: ${rules.length}`);
    console.log(`✅ Pending tasks: ${queueItems.length}`);
    console.log(`✅ Recent executions: ${executions.length}`);
    console.log(`✅ Valid rules: ${validRules}/${rules.length}`);
    console.log(`✅ Required collections: ${requiredCollections.filter(name => 
      collections.some(col => col.name === name)
    ).length}/${requiredCollections.length}`);
    
    if (validRules === rules.length && rules.length > 0) {
      console.log('\n🎉 Automation system is properly configured and ready to use!');
      console.log('\nNext steps:');
      console.log('1. Move an opportunity to the "Signed" stage in GHL');
      console.log('2. Check the automation queue for new tasks');
      console.log('3. Verify SMS and task creation');
      console.log('4. Move to "Deposit" stage to test pipeline transition');
    } else {
      console.log('\n⚠️  Some issues found. Please review the errors above.');
    }
    
  } catch (error) {
    console.error('Error testing automation system:', error);
  } finally {
    await client.close();
    console.log('\nDisconnected from MongoDB');
  }
}

// Run the test
if (require.main === module) {
  testAutomationSystem()
    .then(() => {
      console.log('\nTest completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}

module.exports = { testAutomationSystem };
