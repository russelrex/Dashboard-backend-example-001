const { MongoClient, ObjectId } = require('mongodb');
const MONGODB_URI = 'mongodb+srv://mobileApp:A602ZiVx1ZrZpACw@leadprospectcluster.ujmqx.mongodb.net/lpai?retryWrites=true&w=majority';

async function testQueueProcessing() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('lpai');
  
  try {
    // Get pending automation tasks
    const tasks = await db.collection('automation_queue')
      .find({ 
        status: 'pending',
        attempts: { $lt: 3 }
      })
      .limit(10)
      .toArray();

    console.log(`Processing ${tasks.length} automation tasks`);

    for (const task of tasks) {
      try {
        console.log(`\n--- Processing task ${task._id} ---`);
        
        // Mark as processing
        await db.collection('automation_queue').updateOne(
          { _id: task._id },
          { 
            $set: { status: 'processing' },
            $inc: { attempts: 1 }
          }
        );

        // Get the rule
        const rule = await db.collection('automation_rules')
          .findOne({ _id: new ObjectId(task.ruleId) });

        if (!rule || !rule.isActive) {
          console.log(`❌ Rule not found or inactive: ${task.ruleId}`);
          // Mark as skipped
          await db.collection('automation_queue').updateOne(
            { _id: task._id },
            { $set: { status: 'skipped' } }
          );
          continue;
        }

        console.log(`✅ Found rule: ${rule.name}`);
        console.log(`   Trigger: ${rule.trigger.type} -> ${rule.trigger.stageId}`);
        console.log(`   Actions: ${rule.actions.length}`);

        // Simulate what the execute endpoint would do
        console.log(`\n📋 Simulating execution for rule: ${rule.name}`);
        
        // Check if this rule would match the trigger
        const trigger = task.trigger;
        const wouldMatch = rule.trigger.type === trigger.type || 
                          (rule.trigger.type === 'stage-entered' && rule.trigger.stageId === trigger.stageId) ||
                          (rule.trigger.type === 'enter-stage' && rule.trigger.stageId === trigger.stageId);
        
        if (wouldMatch) {
          console.log(`✅ Rule would match this trigger`);
          
          // Simulate action execution
          for (const action of rule.actions) {
            console.log(`   🔧 Executing action: ${action.type}`);
            
            switch (action.type) {
              case 'send-sms':
                console.log(`      📱 Would send SMS: ${action.config.message}`);
                break;
              case 'create-task':
                console.log(`      📝 Would create task: ${action.config.taskTitle}`);
                break;
              case 'transition-pipeline':
                console.log(`      🔄 Would transition to pipeline: ${action.config.toPipelineId}, stage: ${action.config.toStageId}`);
                break;
              case 'move-to-stage':
                console.log(`      📍 Would move to stage: ${action.config.targetStage}`);
                break;
              default:
                console.log(`      ⚠️  Unknown action type: ${action.type}`);
            }
          }
          
          // Mark as completed
          await db.collection('automation_queue').updateOne(
            { _id: task._id },
            { 
              $set: { 
                status: 'completed',
                completedAt: new Date()
              } 
            }
          );
          console.log(`✅ Task marked as completed`);
          
        } else {
          console.log(`❌ Rule would NOT match this trigger`);
          console.log(`   Rule expects: ${rule.trigger.type} -> ${rule.trigger.stageId}`);
          console.log(`   Trigger has: ${trigger.type} -> ${trigger.stageId}`);
          
          // Mark as failed
          await db.collection('automation_queue').updateOne(
            { _id: task._id },
            { 
              $set: { 
                status: 'failed',
                lastError: 'Rule trigger mismatch'
              } 
            }
          );
        }

      } catch (error) {
        console.error('Task processing error:', error);
        
        // Mark as failed
        await db.collection('automation_queue').updateOne(
          { _id: task._id },
          { 
            $set: { 
              status: 'failed',
              lastError: error instanceof Error ? error.message : String(error)
            } 
          }
        );
      }
    }

    console.log('\n=== Queue Processing Complete ===');
    
    // Show final status
    const finalQueue = await db.collection('automation_queue').find({}).sort({createdAt: -1}).limit(5).toArray();
    console.log('\nFinal queue status:');
    finalQueue.forEach(item => {
      console.log(`- ID: ${item._id}, Status: ${item.status}, Rule: ${item.ruleId}`);
    });

  } catch (error) {
    console.error('Queue processing error:', error);
  } finally {
    await client.close();
  }
}

// Run the test
testQueueProcessing()
  .then(() => {
    console.log('\nTest completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
