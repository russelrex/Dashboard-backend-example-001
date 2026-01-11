// MongoDB Migration Script: Add htmlContent to existing email automations
// Run this script to update existing automation rules with HTML content support

const { MongoClient } = require('mongodb');

async function migrateEmailHtmlContent() {
  const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/lpai');
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db();
    const collection = db.collection('automation_rules');
    
    console.log('Starting migration of email automations...');
    
    const result = await collection.find({
      "actions.type": "send-email"
    }).forEach(async function(rule) {
      let updated = false;
      
      rule.actions.forEach(function(action, index) {
        if (action.type === "send-email" && action.config.body && !action.config.htmlContent) {
          const htmlContent = action.config.body
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('<br>\n');
          
          rule.actions[index].config.htmlContent = htmlContent;
          updated = true;
        }
      });
      
      if (updated) {
        await collection.replaceOne({ _id: rule._id }, rule);
        console.log("Updated rule: " + rule._id + " - " + rule.name);
      }
    });
    
    console.log('Migration completed successfully!');
    
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await client.close();
    console.log('Disconnected from MongoDB');
  }
}

// Run the migration
migrateEmailHtmlContent().catch(console.error);
