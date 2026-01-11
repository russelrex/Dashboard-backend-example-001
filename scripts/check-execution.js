const { MongoClient } = require('mongodb');
const MONGODB_URI = 'mongodb+srv://mobileApp:A602ZiVx1ZrZpACw@leadprospectcluster.ujmqx.mongodb.net/lpai?retryWrites=true&w=majority';

(async () => {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('lpai');
  
  console.log('=== AUTOMATION EXECUTION CHECK ===\n');
  
  // Check automation queue for completed tasks
  const completed = await db.collection('automation_queue')
    .find({ status: 'completed' })
    .sort({ completedAt: -1 })
    .limit(5)
    .toArray();
  
  console.log(`✅ Completed automations: ${completed.length}`);
  completed.forEach(item => {
    console.log(`   - Completed at: ${item.completedAt}, Rule: ${item.ruleId}`);
  });
  
  // Check automation executions
  const executions = await db.collection('automation_executions')
    .find({})
    .sort({ startedAt: -1 })
    .limit(5)
    .toArray();
  
  console.log(`\n📊 Automation executions: ${executions.length}`);
  executions.forEach(exec => {
    console.log(`   - Status: ${exec.status}, Started: ${exec.startedAt}`);
  });
  
  // Check rule statistics
  const rules = await db.collection('automation_rules').find({
    locationId: '5OuaTrizW5wkZMI1xtvX',
    name: { $in: ['Contract Signed - Move to Deposit', 'Deposit Received - Transition to Active Jobs'] }
  }).toArray();
  
  console.log('\n📈 Rule execution stats:');
  rules.forEach(rule => {
    console.log(`   ${rule.name}:`);
    console.log(`      - Executions: ${rule.executionStats?.executionCount || 0}`);
    console.log(`      - Success: ${rule.executionStats?.successCount || 0}`);
    console.log(`      - Failed: ${rule.executionStats?.failureCount || 0}`);
    console.log(`      - Last run: ${rule.executionStats?.lastExecuted || 'Never'}`);
  });
  
  await client.close();
})();
