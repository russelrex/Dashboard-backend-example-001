# Automation System Test Script

This script tests the complete automation system end-to-end, including API endpoints, automation creation, and trigger functionality.

## Prerequisites

1. Make sure the backend server is running (`npm run dev`)
2. Ensure you have a `.env` file with the following variables:
   - `MONGODB_URI` - Your MongoDB connection string
   - `NEXT_PUBLIC_API_URL` - Your API base URL (defaults to http://localhost:3000)

## Running the Test

```bash
# From the lpai-backend directory
npm run test:automations

# Or directly with node
node scripts/test-automations.js
```

## What the Test Does

1. **Authentication**: Prompts for password and authenticates with `michael@leadprospecting.ai`
2. **API Endpoint Testing**: Tests all automation-related endpoints
3. **Pipeline Discovery**: Finds the first available pipeline and stage
4. **Automation Creation**: Creates a test automation rule
5. **Verification**: Confirms the automation was created successfully
6. **Trigger Testing**: Moves a test project to trigger the automation
7. **Cleanup**: Removes the test automation

## Test Results

The script provides colored output showing:
- ✅ **Green**: Successful operations
- ❌ **Red**: Failed operations  
- ℹ️ **Blue**: Information messages
- ⚠️ **Yellow**: Warnings

At the end, you'll see a summary with:
- Total tests run
- Number of passed/failed tests
- Success rate percentage
- Details of any failed tests

## Troubleshooting

### Common Issues

1. **Authentication Failed**: Make sure the user exists and password is correct
2. **No Pipelines Found**: Ensure you have at least one pipeline in your locations collection
3. **API Connection Error**: Verify the backend server is running and accessible
4. **MongoDB Connection Error**: Check your `MONGODB_URI` environment variable

### Debug Mode

To see more detailed error information, you can modify the script to add more logging or run with Node.js debug flags:

```bash
NODE_OPTIONS='--inspect' node scripts/test-automations.js
```

## Expected Output

A successful test run should show:

```
🚀 Starting Automation System Test Suite
==========================================
Enter password for michael@leadprospecting.ai: ****
ℹ️  Authenticating...
✅ Authentication successful
✅ Authentication - PASSED
ℹ️  Testing SMS templates endpoint...
✅ SMS templates returned: 5 templates
✅ SMS Templates API - PASSED
ℹ️  Testing email templates endpoint...
✅ Email templates returned: 3 templates
✅ Email Templates API - PASSED
ℹ️  Testing automation rules endpoint...
✅ Automation rules returned: 0 rules
✅ Automation Rules API - PASSED
✅ Found pipeline: Sales Pipeline (pipeline_123)
✅ Using stage: Lead Qualification (stage_456)
✅ Pipeline and Stage Retrieval - PASSED
ℹ️  Creating test automation...
✅ Test automation created with ID: 507f1f77bcf86cd799439011
✅ Create Test Automation - PASSED
ℹ️  Verifying automation was created...
✅ Automation verification successful
✅ Verify Automation Creation - PASSED
ℹ️  Testing automation trigger...
✅ Using existing test project: 507f1f77bcf86cd799439012
✅ Project moved to trigger stage
✅ Automation queue entry found: 507f1f77bcf86cd799439013
✅ Automation Trigger Test - PASSED
✅ Automation trigger working - queue entry created
ℹ️  Cleaning up test automation...
✅ Test automation deleted successfully
✅ Cleanup Test Automation - PASSED

📊 Test Summary
==============
Total Tests: 7
Passed: 7
Failed: 0
Success Rate: 100.0%

🎯 Test Suite Complete!
```

## Customization

You can modify the test script to:
- Test different automation types
- Use different pipelines/stages
- Add more comprehensive trigger testing
- Test specific automation actions
- Add performance benchmarks

The script is modular, so you can easily extend it for additional testing scenarios. 