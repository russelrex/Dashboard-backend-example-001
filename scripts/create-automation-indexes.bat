@echo off
REM Batch script to create automation system indexes
REM Run this script to create MongoDB indexes for the automation system

echo Creating automation system indexes...

REM MongoDB connection string - update this with your actual connection string
set MONGO_URI=mongodb://localhost:27017/lpai

REM Create a temporary file with MongoDB commands
echo use lpai; > temp_indexes.js
echo. >> temp_indexes.js
echo // Index for scheduled items (status + scheduledFor) >> temp_indexes.js
echo db.automation_queue.createIndex({ >> temp_indexes.js
echo   status: 1, >> temp_indexes.js
echo   scheduledFor: 1 >> temp_indexes.js
echo }, { >> temp_indexes.js
echo   name: "scheduled_items_idx", >> temp_indexes.js
echo   background: true >> temp_indexes.js
echo }); >> temp_indexes.js
echo. >> temp_indexes.js
echo // Index for pending items (status + createdAt + attempts) >> temp_indexes.js
echo db.automation_queue.createIndex({ >> temp_indexes.js
echo   status: 1, >> temp_indexes.js
echo   createdAt: -1, >> temp_indexes.js
echo   attempts: 1 >> temp_indexes.js
echo }, { >> temp_indexes.js
echo   name: "pending_items_idx", >> temp_indexes.js
echo   background: true >> temp_indexes.js
echo }); >> temp_indexes.js
echo. >> temp_indexes.js
echo // Additional performance indexes >> temp_indexes.js
echo db.automation_queue.createIndex({ >> temp_indexes.js
echo   status: 1, >> temp_indexes.js
echo   scheduledFor: 1, >> temp_indexes.js
echo   attempts: 1 >> temp_indexes.js
echo }, { >> temp_indexes.js
echo   name: "status_scheduled_attempts_idx", >> temp_indexes.js
echo   background: true >> temp_indexes.js
echo }); >> temp_indexes.js
echo. >> temp_indexes.js
echo db.automation_queue.createIndex({ >> temp_indexes.js
echo   createdAt: -1 >> temp_indexes.js
echo }, { >> temp_indexes.js
echo   name: "created_at_idx", >> temp_indexes.js
echo   background: true >> temp_indexes.js
echo }); >> temp_indexes.js
echo. >> temp_indexes.js
echo db.automation_queue.createIndex({ >> temp_indexes.js
echo   locationId: 1 >> temp_indexes.js
echo }, { >> temp_indexes.js
echo   name: "location_idx", >> temp_indexes.js
echo   background: true >> temp_indexes.js
echo }); >> temp_indexes.js
echo. >> temp_indexes.js
echo db.automation_queue.createIndex({ >> temp_indexes.js
echo   ruleId: 1 >> temp_indexes.js
echo }, { >> temp_indexes.js
echo   name: "rule_idx", >> temp_indexes.js
echo   background: true >> temp_indexes.js
echo }); >> temp_indexes.js
echo. >> temp_indexes.js
echo db.automation_queue.createIndex({ >> temp_indexes.js
echo   actionType: 1 >> temp_indexes.js
echo }, { >> temp_indexes.js
echo   name: "action_type_idx", >> temp_indexes.js
echo   background: true >> temp_indexes.js
echo }); >> temp_indexes.js
echo. >> temp_indexes.js
echo // Index for automation rules >> temp_indexes.js
echo db.automation_rules.createIndex({ >> temp_indexes.js
echo   locationId: 1, >> temp_indexes.js
echo   isActive: 1 >> temp_indexes.js
echo }, { >> temp_indexes.js
echo   name: "location_active_rules_idx", >> temp_indexes.js
echo   background: true >> temp_indexes.js
echo }); >> temp_indexes.js
echo. >> temp_indexes.js
echo db.automation_rules.createIndex({ >> temp_indexes.js
echo   'trigger.type': 1, >> temp_indexes.js
echo   locationId: 1 >> temp_indexes.js
echo }, { >> temp_indexes.js
echo   name: "trigger_type_location_idx", >> temp_indexes.js
echo   background: true >> temp_indexes.js
echo }); >> temp_indexes.js
echo. >> temp_indexes.js
echo print("All automation system indexes created successfully!"); >> temp_indexes.js

echo Index commands saved to: temp_indexes.js
echo.
echo To run these commands:
echo 1. Open MongoDB shell or MongoDB Compass
echo 2. Copy and paste the commands from temp_indexes.js
echo 3. Or run: mongo ^< temp_indexes.js
echo.
echo Indexes to be created:
echo - scheduled_items_idx: status + scheduledFor
echo - pending_items_idx: status + createdAt + attempts
echo - status_scheduled_attempts_idx: status + scheduledFor + attempts
echo - created_at_idx: createdAt (descending)
echo - location_idx: locationId
echo - rule_idx: ruleId
echo - action_type_idx: actionType
echo - location_active_rules_idx: locationId + isActive
echo - trigger_type_location_idx: trigger.type + locationId
echo.
echo These indexes will significantly improve automation system performance!
echo.
pause
