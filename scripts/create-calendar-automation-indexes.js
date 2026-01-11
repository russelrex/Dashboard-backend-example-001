// MongoDB Shell Script
// Run this once to add performance indexes for calendar automations
// Usage: mongo <database_name> create-calendar-automation-indexes.js

// Use the production database (adjust as needed)
use lpai_production; // or your database name

print('🚀 Creating calendar automation indexes...');

// Index for calendar automation queries
db.automation_rules.createIndex(
  { 
    locationId: 1, 
    calendarId: 1, 
    isCalendarAutomation: 1,
    isActive: 1
  },
  { 
    name: 'calendar_automations_lookup',
    background: true 
  }
);

// Index for SMS templates by calendar
db.sms_templates.createIndex(
  { 
    locationId: 1, 
    calendarId: 1,
    isCalendarTemplate: 1
  },
  { 
    name: 'calendar_sms_templates',
    background: true 
  }
);

// Index for email templates by calendar
db.email_templates.createIndex(
  { 
    locationId: 1, 
    calendarId: 1,
    isCalendarTemplate: 1
  },
  { 
    name: 'calendar_email_templates',
    background: true 
  }
);

print('✅ Calendar automation indexes created successfully');

// Verify indexes were created
print('\n📊 Index verification:');
print('Automation rules indexes:');
db.automation_rules.getIndexes().forEach(index => {
  if (index.name.includes('calendar')) {
    print(`  - ${index.name}: ${JSON.stringify(index.key)}`);
  }
});

print('\nSMS templates indexes:');
db.sms_templates.getIndexes().forEach(index => {
  if (index.name.includes('calendar')) {
    print(`  - ${index.name}: ${JSON.stringify(index.key)}`);
  }
});

print('\nEmail templates indexes:');
db.email_templates.getIndexes().forEach(index => {
  if (index.name.includes('calendar')) {
    print(`  - ${index.name}: ${JSON.stringify(index.key)}`);
  }
});

print('\n🎉 Migration completed successfully!');
