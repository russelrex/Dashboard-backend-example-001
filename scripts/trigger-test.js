const { MongoClient } = require('mongodb');
const MONGODB_URI = 'mongodb+srv://mobileApp:A602ZiVx1ZrZpACw@leadprospectcluster.ujmqx.mongodb.net/lpai?retryWrites=true&w=majority';

(async () => {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('lpai');
  
  // Get the Contract Signed automation rule specifically
  const rule = await db.collection('automation_rules').findOne({
    locationId: '5OuaTrizW5wkZMI1xtvX',
    name: 'Contract Signed - Move to Deposit'
  });
  
  if (!rule) {
    console.log('No rules found! Run insert-automation-rules.js first');
    process.exit(1);
  }
  
  // Create a test trigger for Contract Signed automation
  const result = await db.collection('automation_queue').insertOne({
    ruleId: rule._id.toString(),
    trigger: {
      locationId: '5OuaTrizW5wkZMI1xtvX',
      type: 'stage-entered',
      stageId: 'b48699ce-5a88-4ecd-a2e0-aec07219bc22',
      projectId: 'test-' + Date.now(),
      contactId: 'test-contact-123'
    },
    status: 'pending',
    attempts: 0,
    createdAt: new Date()
  });
  
  console.log('✅ Test trigger created with ID:', result.insertedId);
  console.log('⏰ Will be processed within 60 seconds by cron job');
  console.log('📊 Check Vercel logs: vercel logs --prod --follow');
  
  await client.close();
})();
