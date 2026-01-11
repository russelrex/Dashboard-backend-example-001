# Automation System Documentation

## Overview

The automation system automatically triggers actions based on webhook events from GHL (Go High Level) and other sources. It's designed to handle pipeline transitions, stage changes, and other business process automation.

## Architecture

### Components

1. **Webhook Handler** (`pages/api/webhooks/ghl/native.ts`)
   - Receives GHL webhooks
   - Maps webhook events to automation triggers
   - Queues automation processing

2. **Automation Queue Processor** (`pages/api/cron/process-automation-queue.ts`)
   - Processes queued automation tasks
   - Calls the execute endpoint for each task
   - Handles retries and error management

3. **Automation Execute Endpoint** (`pages/api/automations/execute.ts`)
   - Executes automation rules
   - Handles different action types
   - Manages automation execution lifecycle

4. **Automation Rules** (MongoDB collection: `automation_rules`)
   - Define triggers and actions
   - Configure automation workflows
   - Support location-specific rules

## Pipeline Structure

### Estimates Pipeline (9cGrqJIQlofiY1Ehj8xf)
- **Stage 7: "Signed"** (b48699ce-5a88-4ecd-a2e0-aec07219bc22)
- **Stage 8: "Deposit"** (0a3414cd-bc81-43fa-9b4b-f98906995f99)

### Active Jobs Pipeline (aaSTiFRrEPvGYXR9uw85)
- **Stage 0: "Pending Scheduling"** (dd64488d-9d19-4d8a-9e05-54e0a80b4c09)

## Automation Workflows

### 1. Contract Signed Workflow
**Trigger**: Opportunity moves to "Signed" stage
**Actions**:
- Send SMS to contact requesting deposit
- Create task for deposit collection

**Rule Configuration**:
```json
{
  "name": "Contract Signed - Move to Deposit",
  "trigger": {
    "type": "stage-entered",
    "stageId": "b48699ce-5a88-4ecd-a2e0-aec07219bc22",
    "pipelineId": "9cGrqJIQlofiY1Ehj8xf"
  },
  "actions": [
    {
      "type": "send-sms",
      "config": {
        "recipient": "contact",
        "message": "Contract signed! Please submit your deposit to secure your project start date."
      }
    },
    {
      "type": "create-task",
      "config": {
        "taskTitle": "Collect deposit from {{contact.name}}",
        "assignee": "assigned",
        "priority": "high",
        "dueDate": "3 days from now"
      }
    }
  ]
}
```

### 2. Deposit Received Workflow
**Trigger**: Opportunity moves to "Deposit" stage
**Actions**:
- Transition project to Active Jobs pipeline
- Send SMS confirmation to contact
- Create scheduling task

**Rule Configuration**:
```json
{
  "name": "Deposit Received - Transition to Active Jobs",
  "trigger": {
    "type": "stage-entered",
    "stageId": "0a3414cd-bc81-43fa-9b4b-f98906995f99",
    "pipelineId": "9cGrqJIQlofiY1Ehj8xf"
  },
  "actions": [
    {
      "type": "transition-pipeline",
      "config": {
        "toPipelineId": "aaSTiFRrEPvGYXR9uw85",
        "toStageId": "dd64488d-9d19-4d8a-9e05-54e0a80b4c09"
      }
    },
    {
      "type": "send-sms",
      "config": {
        "recipient": "contact",
        "message": "Deposit received! Your project is now scheduled. We'll contact you soon with start date."
      }
    },
    {
      "type": "create-task",
      "config": {
        "taskTitle": "Schedule project: {{contact.name}}",
        "assignee": "specific",
        "specificUserId": "{{location.schedulerId}}",
        "priority": "high"
      }
    }
  ]
}
```

## Supported Action Types

### 1. `send-sms`
Sends SMS messages to contacts or users.

**Config**:
```json
{
  "type": "send-sms",
  "config": {
    "recipient": "contact|custom",
    "message": "Message template with {{variables}}",
    "from": "location|assigned_user"
  }
}
```

### 2. `create-task`
Creates tasks in the system.

**Config**:
```json
{
  "type": "create-task",
  "config": {
    "taskTitle": "Task title with {{variables}}",
    "assignee": "assigned|specific",
    "specificUserId": "user-id-if-specific",
    "priority": "high|medium|low",
    "dueDate": "ISO date string"
  }
}
```

### 3. `move-to-stage`
Moves a project to a specific stage within the same pipeline.

**Config**:
```json
{
  "type": "move-to-stage",
  "config": {
    "targetStage": "stage-id",
    "targetPipeline": "pipeline-id"
  }
}
```

### 4. `transition-pipeline`
Moves a project to a different pipeline and stage.

**Config**:
```json
{
  "type": "transition-pipeline",
  "config": {
    "toPipelineId": "target-pipeline-id",
    "toStageId": "target-stage-id"
  }
}
```

### 5. `send-email`
Sends emails to contacts or users.

**Config**:
```json
{
  "type": "send-email",
  "config": {
    "recipient": "contact|user",
    "subject": "Email subject",
    "templateId": "template-id",
    "from": "location|assigned_user"
  }
}
```

### 6. `push-notification`
Sends push notifications to users.

**Config**:
```json
{
  "type": "push-notification",
  "config": {
    "recipient": "assigned_user|specific_user",
    "title": "Notification title",
    "message": "Notification message",
    "data": { "key": "value" }
  }
}
```

### 7. `add-tag` / `remove-tag`
Manages tags on contacts.

**Config**:
```json
{
  "type": "add-tag",
  "config": {
    "tagId": "tag-id-to-add"
  }
}
```

### 8. `update-custom-field`
Updates custom fields on contacts.

**Config**:
```json
{
  "type": "update-custom-field",
  "config": {
    "fieldName": "field-name",
    "fieldValue": "new-value"
  }
}
```

### 9. `webhook`
Calls external webhooks.

**Config**:
```json
{
  "type": "webhook",
  "config": {
    "webhookUrl": "https://api.example.com/webhook",
    "method": "POST",
    "headers": { "Authorization": "Bearer {{token}}" },
    "body": { "event": "{{trigger.type}}" }
  }
}
```

## Data Flow

### 1. Webhook Reception
1. GHL sends webhook to `/api/webhooks/ghl/native`
2. Webhook is verified and parsed
3. Automation triggers are identified based on event type
4. Triggers are queued in `automation_queue` collection

### 2. Queue Processing
1. Cron job `/api/cron/process-automation-queue` runs every minute
2. Pending automation tasks are retrieved
3. Each task is sent to `/api/automations/execute`
4. Execute endpoint finds matching rules and executes actions

### 3. Rule Execution
1. Rules are matched based on trigger type and stage ID
2. Conditions are checked (if any)
3. Actions are executed sequentially
4. Results are logged and statistics updated

## Database Collections

### `automation_rules`
Stores automation rule definitions:
```json
{
  "_id": "ObjectId",
  "locationId": "string",
  "name": "string",
  "description": "string",
  "isActive": "boolean",
  "priority": "number",
  "trigger": {
    "type": "string",
    "stageId": "string",
    "pipelineId": "string"
  },
  "actions": ["array of actions"],
  "executionStats": {
    "executionCount": "number",
    "successCount": "number",
    "failureCount": "number",
    "lastExecuted": "Date"
  },
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### `automation_queue`
Stores pending automation tasks:
```json
{
  "_id": "ObjectId",
  "ruleId": "ObjectId",
  "trigger": "object",
  "status": "pending|processing|completed|failed|skipped",
  "attempts": "number",
  "createdAt": "Date",
  "completedAt": "Date",
  "lastError": "string"
}
```

### `automation_executions`
Stores execution history:
```json
{
  "_id": "ObjectId",
  "automationId": "ObjectId",
  "locationId": "string",
  "triggerType": "string",
  "entityId": "string",
  "entityType": "string",
  "startedAt": "Date",
  "completedAt": "Date",
  "status": "running|completed|failed",
  "actions": ["array of action results"],
  "data": "object"
}
```

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Environment Variables
```bash
MONGODB_URI=mongodb://localhost:27017/lpai
NEXT_PUBLIC_API_URL=https://your-domain.vercel.app
CRON_SECRET=your-secret-key
```

### 3. Insert Automation Rules
```bash
npm run automation:insert-rules
```

### 4. Test the System
```bash
npm run automation:test
```

### 5. Test the Workflow
1. Move an opportunity to the "Signed" stage in GHL
2. Check that the automation triggers
3. Verify SMS is sent and task is created
4. Move to "Deposit" stage
5. Verify pipeline transition occurs

## Monitoring and Debugging

### Logs
The system logs all automation activities:
- Webhook reception and parsing
- Automation rule matching
- Action execution
- Success/failure status

### Database Monitoring
- Check `automation_queue` for pending tasks
- Review `automation_executions` for execution history
- Monitor `automation_rules` execution statistics

### Real-time Events
Automation events are published to Ably channels:
- `automation:triggered` - When automation starts
- `automation:completed` - When automation finishes

## Troubleshooting

### Common Issues

1. **Automation not triggering**
   - Check webhook signature verification
   - Verify automation rules are active
   - Check location ID matches
   - Verify trigger type and stage ID match

2. **Actions failing**
   - Check action configuration
   - Verify required fields are present
   - Check database permissions
   - Review action-specific error logs

3. **Pipeline transitions not working**
   - Verify pipeline and stage IDs
   - Check project exists in database
   - Verify database update permissions
   - Check action configuration

4. **Queue not processing**
   - Verify cron job is running
   - Check automation queue collection
   - Verify execute endpoint is accessible
   - Check for errors in queue processing

### Debug Mode
Enable debug logging by setting:
```bash
DEBUG=automation:*
```

## Extending the System

### Adding New Action Types
1. Add case in `executeAction` function in `execute.ts`
2. Implement action execution function
3. Update action configuration schema
4. Test with sample data

### Adding New Trigger Types
1. Add trigger case in webhook handler
2. Update automation rule query logic
3. Add trigger type to rule schema
4. Test with sample webhooks

### Custom Variables
1. Add variable extraction logic in action functions
2. Update variable substitution in templates
3. Document new variables
4. Test variable resolution

## Security Considerations

- Webhook signatures are verified using GHL public key
- Timestamp validation prevents replay attacks
- Database queries use parameterized inputs
- Automation execution is isolated from webhook processing
- Cron jobs require proper authentication

## Performance Considerations

- Automation processing is asynchronous
- Database queries are optimized with indexes
- Real-time events are batched where possible
- Failed automations are retried with exponential backoff
- Queue processing is limited to prevent overload

## API Endpoints

### POST `/api/automations/execute`
Executes automation rules based on events.

**Request Body**:
```json
{
  "event": {
    "locationId": "string",
    "type": "string",
    "stageId": "string",
    "projectId": "string",
    "contactId": "string",
    "ruleId": "string (optional)"
  }
}
```

**Response**:
```json
{
  "results": [
    {
      "ruleId": "string",
      "success": "boolean",
      "error": "string (if failed)"
    }
  ]
}
```

### GET `/api/cron/process-automation-queue`
Processes pending automation tasks (cron endpoint).

**Headers**:
- `Authorization: Bearer {CRON_SECRET}` or
- `x-vercel-cron: 1`

**Response**:
```json
{
  "processed": "number",
  "success": "number",
  "failed": "number"
}
```
