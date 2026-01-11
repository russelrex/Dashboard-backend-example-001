// scripts/create-automation-collections.js
const { MongoClient } = require('mongodb');
require('dotenv').config();

async function createCollections() {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://mobileApp:A602ZiVx1ZrZpACw@leadprospectcluster.ujmqx.mongodb.net/lpai?retryWrites=true&w=majority';
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db();
    
    // Create automation_rules collection
    await db.createCollection('automation_rules');
    await db.collection('automation_rules').createIndex({ locationId: 1 });
    await db.collection('automation_rules').createIndex({ pipelineId: 1, stageId: 1 });
    
    // Create sms_templates collection
    await db.createCollection('sms_templates');
    await db.collection('sms_templates').createIndex({ locationId: 1 });
    
    // Create email_templates collection
    await db.createCollection('email_templates');
    await db.collection('email_templates').createIndex({ locationId: 1 });
    
    console.log('Collections created successfully!');
  } catch (error) {
    console.error('Error creating collections:', error);
  } finally {
    await client.close();
  }
}

createCollections();