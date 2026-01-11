// File: scripts/test-automations.js
// Created: December 2024
// Description: Test script for automation system

const axios = require('axios');
const { MongoClient } = require('mongodb');
const readline = require('readline');
require('dotenv').config();

// Configuration
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://mobileApp:A602ZiVx1ZrZpACw@leadprospectcluster.ujmqx.mongodb.net/lpai?retryWrites=true&w=majority';

// Test credentials
const TEST_EMAIL = 'michael@leadprospecting.ai';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

// Create readline interface for password input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function promptPassword() {
  return new Promise((resolve) => {
    rl.question('Enter password for michael@leadprospecting.ai: ', (password) => {
      rl.close();
      resolve(password);
    });
  });
}

// Test results tracking
const testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

function recordTest(name, passed, error = null) {
  testResults.tests.push({ name, passed, error });
  if (passed) {
    testResults.passed++;
    logSuccess(`${name} - PASSED`);
  } else {
    testResults.failed++;
    logError(`${name} - FAILED${error ? `: ${error}` : ''}`);
  }
}

// Authentication
async function getAuthToken(email, password) {
  try {
    logInfo(`Authenticating with ${BASE_URL}/api/login...`);
    const response = await axios.post(`${BASE_URL}/api/login`, {
      email,
      password
    });
    
    if (response.data.token) {
      logSuccess('Authentication successful');
      logInfo(`Token received (first 20 chars): ${response.data.token.substring(0, 20)}...`);
      return response.data.token;
    } else {
      throw new Error('No token received');
    }
  } catch (error) {
    logError(`Auth request failed: ${error.response?.status} - ${error.response?.statusText}`);
    if (error.response?.data) {
      logError(`Error response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    throw new Error(`Authentication failed: ${error.response?.data?.error || error.message}`);
  }
}

// Test API endpoints
async function testSMSTemplates(token) {
  try {
    logInfo('Testing SMS templates endpoint...');
    const response = await axios.get(`${BASE_URL}/api/sms/templates?locationId=5OuaTrizW5wkZMI1xtvX`, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.status === 200 && response.data.templates) {
      const templates = response.data.templates;
      logSuccess(`SMS templates returned: ${templates.length} templates`);
      if (templates.length > 0) {
        logInfo(`First template: ${templates[0].name}`);
      }
      return templates;
    } else {
      throw new Error('Invalid response format - expected templates array');
    }
  } catch (error) {
    logError(`SMS templates request failed: ${error.response?.status} - ${error.response?.statusText}`);
    if (error.response?.data) {
      logError(`Error response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    throw new Error(`SMS templates test failed: ${error.response?.data?.error || error.message}`);
  }
}

async function testEmailTemplates(token) {
  try {
    logInfo('Testing email templates endpoint...');
    const response = await axios.get(`${BASE_URL}/api/emails/templates?locationId=5OuaTrizW5wkZMI1xtvX`, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.status === 200 && response.data.templates) {
      const templates = response.data.templates;
      logSuccess(`Email templates returned: ${templates.length} templates`);
      if (templates.length > 0) {
        logInfo(`First template: ${templates[0].name}`);
      }
      return templates;
    } else {
      throw new Error('Invalid response format - expected templates array');
    }
  } catch (error) {
    logError(`Email templates request failed: ${error.response?.status} - ${error.response?.statusText}`);
    if (error.response?.data) {
      logError(`Error response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    throw new Error(`Email templates test failed: ${error.response?.data?.error || error.message}`);
  }
}

async function testAutomationRules(token) {
  try {
    logInfo('Testing automation rules endpoint...');
    const response = await axios.get(`${BASE_URL}/api/automations/rules`, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.status === 200 && response.data.rules) {
      const rules = response.data.rules;
      logSuccess(`Automation rules returned: ${rules.length} rules`);
      return rules;
    } else {
      throw new Error('Invalid response format - expected rules array');
    }
  } catch (error) {
    logError(`Automation rules request failed: ${error.response?.status} - ${error.response?.statusText}`);
    if (error.response?.data) {
      logError(`Error response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    throw new Error(`Automation rules test failed: ${error.response?.data?.error || error.message}`);
  }
}

// Database operations
async function getFirstPipeline() {
  let client = null;
  try {
    logInfo('Connecting to MongoDB...');
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    logSuccess('Connected to MongoDB');
    
    const db = client.db();
    const locationsCollection = db.collection('locations');
    
    // Find any location with pipelines
    const location = await locationsCollection.findOne({
      'pipelines.0': { $exists: true }
    });
    
    if (!location || !location.pipelines || location.pipelines.length === 0) {
      throw new Error('No pipelines found in any location');
    }
    
    const pipeline = location.pipelines[0];
    logSuccess(`Found pipeline: ${pipeline.name} (${pipeline.id})`);
    
    return { pipeline, locationId: location._id };
  } catch (error) {
    throw new Error(`Failed to get pipeline: ${error.message}`);
  } finally {
    if (client) {
      await client.close();
      logInfo('MongoDB connection closed');
    }
  }
}

async function getFirstStage(pipeline) {
  if (!pipeline.stages || pipeline.stages.length === 0) {
    throw new Error('No stages found in pipeline');
  }
  
  const stage = pipeline.stages[0];
  logSuccess(`Using stage: ${stage.name} (${stage.id})`);
  return stage;
}

// Create test automation
async function createTestAutomation(token, pipeline, stage) {
  try {
    logInfo('Creating test automation...');
    
    const automationData = {
      name: "Test Automation - Delete Me",
      description: "Automated test - safe to delete",
      pipelineId: pipeline.id,
      stageId: stage.id,
      trigger: {
        type: "enter-stage",
        config: {}
      },
      actions: [{
        type: "send-sms",
        config: {
          message: "Test automation triggered for {{contact.firstName}}",
          from: "location",
          recipient: "contact"
        }
      }],
      priority: 0,
      isActive: true
    };
    
    logInfo(`Sending POST request to ${BASE_URL}/api/automations/rules`);
    const response = await axios.post(`${BASE_URL}/api/automations/rules`, automationData, {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.status === 200 && response.data.id) {
      logSuccess(`Test automation created with ID: ${response.data.id}`);
      return { ...automationData, id: response.data.id, _id: response.data.id };
    } else {
      throw new Error('Invalid response format');
    }
  } catch (error) {
    logError(`Create automation request failed: ${error.response?.status} - ${error.response?.statusText}`);
    if (error.response?.data) {
      logError(`Error response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    throw new Error(`Failed to create test automation: ${error.response?.data?.error || error.message}`);
  }
}

// Test automation trigger
async function testAutomationTrigger(pipeline, stage) {
  let client = null;
  try {
    logInfo('Testing automation trigger by checking queue...');
    
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    
    const db = client.db();
    const automationQueueCollection = db.collection('automation_queue');
    
    // Check if any queue entries exist
    const queueCount = await automationQueueCollection.countDocuments();
    logInfo(`Total queue entries: ${queueCount}`);
    
    // Check for recent queue entries
    const recentEntries = await automationQueueCollection
      .find({ 
        createdAt: { $gte: new Date(Date.now() - 60000) } // Last minute
      })
      .limit(5)
      .toArray();
    
    if (recentEntries.length > 0) {
      logSuccess(`Found ${recentEntries.length} recent queue entries`);
      recentEntries.forEach((entry, index) => {
        logInfo(`Queue entry ${index + 1}: ${entry.status} - Rule: ${entry.ruleId}`);
      });
    } else {
      logWarning('No recent queue entries found - automations may not be triggering via webhooks');
    }
    
    return { queueCount, recentEntries };
    
  } catch (error) {
    throw new Error(`Automation trigger test failed: ${error.message}`);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

// Cleanup test automation
async function cleanupTestAutomation(token, automationId) {
  let client = null;
  try {
    logInfo('Cleaning up test automation from database...');
    
    // Since we don't have a DELETE endpoint, clean up directly in MongoDB
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    
    const db = client.db();
    const result = await db.collection('automation_rules').deleteOne({
      name: "Test Automation - Delete Me"
    });
    
    if (result.deletedCount > 0) {
      logSuccess('Test automation deleted from database');
    } else {
      logWarning('Test automation not found in database (may have been deleted already)');
    }
    
    return true;
  } catch (error) {
    throw new Error(`Failed to delete test automation: ${error.message}`);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

// Main test function
async function runTests() {
  log('\n🚀 Starting Automation System Test Suite', 'bright');
  log('==========================================', 'bright');
  logInfo(`Testing against: ${BASE_URL}`);
  
  let token = null;
  let testAutomation = null;
  
  try {
    // Step 1: Get password and authenticate
    const password = await promptPassword();
    try {
      token = await getAuthToken(TEST_EMAIL, password);
      recordTest('Authentication', true);
    } catch (error) {
      recordTest('Authentication', false, error.message);
      throw error; // Can't continue without auth
    }
    
    // Step 2: Test API endpoints
    try {
      const smsTemplates = await testSMSTemplates(token);
      recordTest('SMS Templates API', smsTemplates.length >= 5, 
        smsTemplates.length < 5 ? `Expected at least 5 templates, got ${smsTemplates.length}` : null);
    } catch (error) {
      recordTest('SMS Templates API', false, error.message);
    }
    
    try {
      const emailTemplates = await testEmailTemplates(token);
      recordTest('Email Templates API', emailTemplates.length >= 3,
        emailTemplates.length < 3 ? `Expected at least 3 templates, got ${emailTemplates.length}` : null);
    } catch (error) {
      recordTest('Email Templates API', false, error.message);
    }
    
    try {
      const automationRules = await testAutomationRules(token);
      recordTest('Automation Rules API', true);
      logInfo(`Current automation rules: ${automationRules.length}`);
    } catch (error) {
      recordTest('Automation Rules API', false, error.message);
    }
    
    // Step 3: Get pipeline and stage data
    let pipeline, locationId, stage;
    try {
      const pipelineData = await getFirstPipeline();
      pipeline = pipelineData.pipeline;
      locationId = pipelineData.locationId;
      stage = await getFirstStage(pipeline);
      recordTest('Pipeline and Stage Retrieval', true);
    } catch (error) {
      recordTest('Pipeline and Stage Retrieval', false, error.message);
      throw error; // Can't continue without pipeline data
    }
    
    // Step 4: Create test automation
    try {
      testAutomation = await createTestAutomation(token, pipeline, stage);
      recordTest('Create Test Automation', !!testAutomation.id);
    } catch (error) {
      recordTest('Create Test Automation', false, error.message);
    }
    
    // Step 5: Test automation queue
    try {
      const triggerResult = await testAutomationTrigger(pipeline, stage);
      recordTest('Automation Queue Check', true);
      
      if (triggerResult.queueCount > 0) {
        logSuccess(`✅ Automation queue is active with ${triggerResult.queueCount} entries`);
      } else {
        logWarning('⚠️  Automation queue is empty - check if webhooks are triggering automations');
      }
    } catch (error) {
      recordTest('Automation Queue Check', false, error.message);
    }
    
  } catch (error) {
    logError(`Test suite error: ${error.message}`);
    recordTest('Test Suite Execution', false, error.message);
  } finally {
    // Step 6: Cleanup
    if (testAutomation) {
      try {
        await cleanupTestAutomation(token, testAutomation.id);
        recordTest('Cleanup Test Automation', true);
      } catch (error) {
        recordTest('Cleanup Test Automation', false, error.message);
      }
    }
  }
  
  // Print summary
  log('\n📊 Test Summary', 'bright');
  log('==============', 'bright');
  log(`Total Tests: ${testResults.tests.length}`, 'cyan');
  log(`Passed: ${testResults.passed}`, 'green');
  log(`Failed: ${testResults.failed}`, 'red');
  log(`Success Rate: ${((testResults.passed / testResults.tests.length) * 100).toFixed(1)}%`, 'cyan');
  
  if (testResults.failed > 0) {
    log('\n❌ Failed Tests:', 'red');
    testResults.tests
      .filter(test => !test.passed)
      .forEach(test => {
        log(`  - ${test.name}: ${test.error}`, 'red');
      });
  }
  
  log('\n🎯 Test Suite Complete!', 'bright');
  log('\n📝 Next Steps:', 'cyan');
  log('1. Check MongoDB Compass for created automation rules', 'cyan');
  log('2. Trigger a webhook event to test automation execution', 'cyan');
  log('3. Monitor the automation_queue collection for processing', 'cyan');
  log('4. Check logs in Vercel dashboard for any errors', 'cyan');
}

// Run the tests
if (require.main === module) {
  runTests().catch(error => {
    logError(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { runTests };