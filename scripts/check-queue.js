const { MongoClient } = require('mongodb');
const MONGODB_URI = 'mongodb+srv://mobileApp:A602ZiVx1ZrZpACw@leadprospectcluster.ujmqx.mongodb.net/lpai?retryWrites=true&w=majority';

(async () => {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('lpai');
  
  const queue = await db.collection('automation_queue').find({}).sort({createdAt: -1}).limit(5).toArray();
  console.log('Recent automation queue items:');
  queue.forEach(item => {
    console.log(`- ID: ${item._id}, Status: ${item.status}, Created: ${item.createdAt}, Rule: ${item.ruleId}`);
  });
  
  await client.close();
})();
