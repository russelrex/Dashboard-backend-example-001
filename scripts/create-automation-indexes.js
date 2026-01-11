// MongoDB script to create automation system indexes
// Run this in MongoDB shell or via MongoDB Compass

console.log('Creating automation system indexes...');

// Index for scheduled items (status + scheduledFor)
db.automation_queue.createIndex({ 
  status: 1, 
  scheduledFor: 1 
}, { 
  name: "scheduled_items_idx",
  background: true
});

console.log('✅ Created scheduled_items_idx');

// Index for pending items (status + createdAt + attempts)
db.automation_queue.createIndex({ 
  status: 1, 
  createdAt: -1,
  attempts: 1
}, { 
  name: "pending_items_idx",
  background: true
});

console.log('✅ Created pending_items_idx');

// Additional performance indexes
db.automation_queue.createIndex({ 
  status: 1, 
  scheduledFor: 1, 
  attempts: 1 
}, { 
  name: "status_scheduled_attempts_idx",
  background: true
});

console.log('✅ Created status_scheduled_attempts_idx');

db.automation_queue.createIndex({ 
  createdAt: -1 
}, { 
  name: "created_at_idx",
  background: true
});

console.log('✅ Created created_at_idx');

db.automation_queue.createIndex({ 
  locationId: 1 
}, { 
  name: "location_idx",
  background: true
});

console.log('✅ Created location_idx');

db.automation_queue.createIndex({ 
  ruleId: 1 
}, { 
  name: "rule_idx",
  background: true
});

console.log('✅ Created rule_idx');

db.automation_queue.createIndex({ 
  actionType: 1 
}, { 
  name: "action_type_idx",
  background: true
});

console.log('✅ Created action_type_idx');

// Index for automation rules
db.automation_rules.createIndex({ 
  locationId: 1, 
  isActive: 1 
}, { 
  name: "location_active_rules_idx",
  background: true
});

console.log('✅ Created location_active_rules_idx');

db.automation_rules.createIndex({ 
  'trigger.type': 1, 
  locationId: 1 
}, { 
  name: "trigger_type_location_idx",
  background: true
});

console.log('✅ Created trigger_type_location_idx');

console.log('\n🎉 All automation system indexes created successfully!');
console.log('\nIndexes created:');
console.log('- scheduled_items_idx: status + scheduledFor');
console.log('- pending_items_idx: status + createdAt + attempts');
console.log('- status_scheduled_attempts_idx: status + scheduledFor + attempts');
console.log('- created_at_idx: createdAt (descending)');
console.log('- location_idx: locationId');
console.log('- rule_idx: ruleId');
console.log('- action_type_idx: actionType');
console.log('- location_active_rules_idx: locationId + isActive');
console.log('- trigger_type_location_idx: trigger.type + locationId');

console.log('\nThese indexes will significantly improve automation system performance!');
