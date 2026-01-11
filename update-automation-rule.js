#!/usr/bin/env node

/**
 * MongoDB Script to Update Automation Rule
 * Adds push notification action to the existing rule
 */

require('dotenv').config({ path: '.env.local' });
const { MongoClient, ObjectId } = require('mongodb');

async function updateAutomationRule() {
  let client;
  
  try {
    console.log('🔌 Connecting to MongoDB...');
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI not found in .env.local');
    }
    
    client = new MongoClient(mongoUri);
    await client.connect();
    const db = client.db();
    console.log('✅ MongoDB connected successfully');
    
    // Update the automation rule to add push notification action
    const ruleId = '687ff62358ab6c38f1e29bc1';
    
    console.log(`\n🔧 Updating automation rule: ${ruleId}`);
    
    // First, check if the rule exists
    const existingRule = await db.collection('automation_rules').findOne({
      _id: new ObjectId(ruleId)
    });
    
    if (!existingRule) {
      console.log('❌ Automation rule not found');
      return;
    }
    
    console.log('📋 Current rule:', {
      name: existingRule.name,
      actions: existingRule.actions?.map(a => a.type) || []
    });
    
    // Check if push notification action already exists
    const hasPushNotification = existingRule.actions?.some(action => 
      action.type === 'push-notification'
    );
    
    if (hasPushNotification) {
      console.log('✅ Push notification action already exists');
      return;
    }
    
    // Add push notification action
    const pushNotificationAction = {
      type: 'push-notification',
      config: {
        recipient: 'assigned',
        title: 'New Lead Assigned',
        message: 'New lead {{contact.firstName}} {{contact.lastName}} has been assigned to you',
        delay: { amount: 0, unit: 'minutes' }
      }
    };
    
    const result = await db.collection('automation_rules').updateOne(
      { _id: new ObjectId(ruleId) },
      { 
        $push: { 
          actions: pushNotificationAction
        },
        $set: {
          updatedAt: new Date()
        }
      }
    );
    
    if (result.modifiedCount > 0) {
      console.log('✅ Successfully added push notification action');
      
      // Verify the update
      const updatedRule = await db.collection('automation_rules').findOne({
        _id: new ObjectId(ruleId)
      });
      
      console.log('📋 Updated rule actions:', updatedRule.actions?.map(a => a.type) || []);
    } else {
      console.log('❌ Failed to update automation rule');
    }
    
  } catch (error) {
    console.error('❌ Error updating automation rule:', error);
  } finally {
    if (client) {
      await client.close();
      console.log('🔌 MongoDB disconnected');
    }
  }
}

// Run the update
if (require.main === module) {
  updateAutomationRule().catch(console.error);
}

module.exports = updateAutomationRule;
