const { MongoClient, ObjectId } = require('mongodb');
const MONGODB_URI = 'mongodb+srv://mobileApp:A602ZiVx1ZrZpACw@leadprospectcluster.ujmqx.mongodb.net/lpai?retryWrites=true&w=majority';

(async () => {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('lpai');
  
  // Check the specific rule that was referenced
  const ruleId = '687ff62358ab6c38f1e29bc1';
  const rule = await db.collection('automation_rules').findOne({ _id: new ObjectId(ruleId) });
  
  if (rule) {
    console.log('✅ Rule found:');
    console.log(`   Name: ${rule.name}`);
    console.log(`   Active: ${rule.isActive}`);
    console.log(`   Trigger: ${rule.trigger.type} -> ${rule.trigger.stageId}`);
    console.log(`   Actions: ${rule.actions.length}`);
  } else {
    console.log('❌ Rule not found with ID:', ruleId);
  }
  
  // Check all rules for this location
  const allRules = await db.collection('automation_rules').find({
    locationId: '5OuaTrizW5wkZMI1xtvX'
  }).toArray();
  
  console.log(`\n📊 Total rules for location: ${allRules.length}`);
  allRules.forEach(r => {
    console.log(`   - ${r.name} (${r._id}) - Active: ${r.isActive}`);
  });
  
  await client.close();
})();
