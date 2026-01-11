const BugReport = require('../../models/BugReport');

exports.createBugReport = async (req, res) => {
  try {
    const {
      reporterName,
      screen,
      component,
      issue,
      steps,
      expected,
      actual,
      priority,
      additionalNotes,
      deviceInfo
    } = req.body;

    // Validate required fields
    if (!reporterName || !screen || !issue || !steps) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: reporterName, screen, issue, steps'
      });
    }

    // Create bug report
    const bugReport = new BugReport({
      reporterName,
      screen,
      component,
      issue,
      steps,
      expected,
      actual,
      priority,
      additionalNotes,
      deviceInfo,
      status: 'New',
      submittedAt: new Date()
    });

    await bugReport.save();

    // Optional: Send email notification here if you have email service set up

    res.status(201).json({
      success: true,
      message: 'Bug report submitted successfully',
      reportId: bugReport._id
    });

  } catch (error) {
    console.error('Bug report submission error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit bug report'
    });
  }
};