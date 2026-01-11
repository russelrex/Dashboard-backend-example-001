# PowerShell script to create automation system indexes
# Run this script to create MongoDB indexes for the automation system

Write-Host "Creating automation system indexes..." -ForegroundColor Green

# MongoDB connection string - update this with your actual connection string
$mongoUri = "mongodb://localhost:27017/lpai"

# MongoDB commands to create indexes
$indexCommands = @"
use lpai;

// Index for scheduled items (status + scheduledFor)
db.automation_queue.createIndex({ 
  status: 1, 
  scheduledFor: 1 
}, { 
  name: "scheduled_items_idx",
  background: true
});

// Index for pending items (status + createdAt + attempts)
db.automation_queue.createIndex({ 
  status: 1, 
  createdAt: -1,
  attempts: 1
}, { 
  name: "pending_items_idx",
  background: true
});

// Additional performance indexes
db.automation_queue.createIndex({ 
  status: 1, 
  scheduledFor: 1, 
  attempts: 1 
}, { 
  name: "status_scheduled_attempts_idx",
  background: true
});

db.automation_queue.createIndex({ 
  createdAt: -1 
}, { 
  name: "created_at_idx",
  background: true
});

db.automation_queue.createIndex({ 
  locationId: 1 
}, { 
  name: "location_idx",
  background: true
});

db.automation_queue.createIndex({ 
  ruleId: 1 
}, { 
  name: "rule_idx",
  background: true
});

db.automation_queue.createIndex({ 
  actionType: 1 
}, { 
  name: "action_type_idx",
  background: true
});

// Index for automation rules
db.automation_rules.createIndex({ 
  locationId: 1, 
  isActive: 1 
}, { 
  name: "location_active_rules_idx",
  background: true
});

db.automation_rules.createIndex({ 
  'trigger.type': 1, 
  locationId: 1 
}, { 
  name: "trigger_type_location_idx",
  background: true
});

print("All automation system indexes created successfully!");
"@

# Save commands to a temporary file
$tempFile = [System.IO.Path]::GetTempFileName()
$indexCommands | Out-File -FilePath $tempFile -Encoding UTF8

Write-Host "Index commands saved to: $tempFile" -ForegroundColor Yellow
Write-Host "To run these commands:" -ForegroundColor Cyan
Write-Host "1. Open MongoDB shell or MongoDB Compass" -ForegroundColor White
Write-Host "2. Copy and paste the commands from the file above" -ForegroundColor White
Write-Host "3. Or run: mongo < $tempFile" -ForegroundColor White

Write-Host "`nIndexes to be created:" -ForegroundColor Green
Write-Host "- scheduled_items_idx: status + scheduledFor" -ForegroundColor White
Write-Host "- pending_items_idx: status + createdAt + attempts" -ForegroundColor White
Write-Host "- status_scheduled_attempts_idx: status + scheduledFor + attempts" -ForegroundColor White
Write-Host "- created_at_idx: createdAt (descending)" -ForegroundColor White
Write-Host "- location_idx: locationId" -ForegroundColor White
Write-Host "- rule_idx: ruleId" -ForegroundColor White
Write-Host "- action_type_idx: actionType" -ForegroundColor White
Write-Host "- location_active_rules_idx: locationId + isActive" -ForegroundColor White
Write-Host "- trigger_type_location_idx: trigger.type + locationId" -ForegroundColor White

Write-Host "`nThese indexes will significantly improve automation system performance!" -ForegroundColor Green
