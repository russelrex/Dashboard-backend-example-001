const mongoose = require('mongoose');

const bugReportSchema = new mongoose.Schema({
  reporterName: { type: String, required: true },
  screen: { type: String, required: true },
  component: String,
  issue: { type: String, required: true },
  steps: { type: String, required: true },
  expected: String,
  actual: String,
  priority: { type: String, enum: ['High', 'Medium', 'Low'], default: 'Medium' },
  additionalNotes: String,
  deviceInfo: {
    platform: String,
    platformVersion: String,
    screenWidth: Number,
    screenHeight: Number,
    timestamp: Date
  },
  status: { type: String, enum: ['New', 'In Progress', 'Fixed', 'Won\'t Fix'], default: 'New' },
  submittedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('BugReport', bugReportSchema);