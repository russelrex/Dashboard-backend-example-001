// lpai-backend/pages/api/bug-reports.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../src/lib/mongodb';
import { Resend } from 'resend';

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Format device info for email
const formatDeviceInfo = (deviceInfo: any) => {
  if (!deviceInfo) return 'No device info provided';
  
  return `
Platform: ${deviceInfo.platform || 'Unknown'}
Version: ${deviceInfo.platformVersion || 'Unknown'}
Screen: ${deviceInfo.screenWidth || '?'} x ${deviceInfo.screenHeight || '?'}
Timestamp: ${deviceInfo.timestamp || new Date().toISOString()}`;
};

// Format priority with emoji
const getPriorityEmoji = (priority: string) => {
  switch (priority) {
    case 'High': return '🔴';
    case 'Low': return '🟢';
    default: return '🟡';
  }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ 
      success: false, 
      message: `Method ${req.method} Not Allowed` 
    });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
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

    // Insert bug report into MongoDB
    const result = await db.collection('bugreports').insertOne({
      reporterName,
      screen,
      component,
      issue,
      steps,
      expected,
      actual,
      priority: priority || 'Medium',
      additionalNotes,
      deviceInfo,
      status: 'New',
      submittedAt: new Date(),
      updatedAt: new Date()
    });

    const reportId = result.insertedId.toString();

    // Send email notification
    try {
      const priorityEmoji = getPriorityEmoji(priority || 'Medium');
      const emailSubject = `${priorityEmoji} [LPai] ${priority || 'Medium'} Priority Bug Report - ${screen}`;
      
      const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .priority-high { color: #dc3545; font-weight: bold; }
    .priority-medium { color: #ffc107; font-weight: bold; }
    .priority-low { color: #28a745; font-weight: bold; }
    .section { margin-bottom: 20px; padding: 15px; background-color: #f8f9fa; border-radius: 8px; }
    .label { font-weight: bold; color: #495057; margin-bottom: 5px; }
    .content { white-space: pre-wrap; word-wrap: break-word; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; color: #6c757d; font-size: 14px; }
    .button { display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>🐛 New Bug Report Submitted</h2>
      <p><strong>Report ID:</strong> ${reportId}</p>
      <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
    </div>

    <div class="section">
      <div class="label">Reporter:</div>
      <div class="content">${reporterName}</div>
    </div>

    <div class="section">
      <div class="label">Priority:</div>
      <div class="content priority-${(priority || 'Medium').toLowerCase()}">${priorityEmoji} ${priority || 'Medium'}</div>
    </div>

    <div class="section">
      <div class="label">Screen/Page:</div>
      <div class="content">${screen}</div>
      ${component ? `
      <div class="label" style="margin-top: 10px;">Component:</div>
      <div class="content">${component}</div>
      ` : ''}
    </div>

    <div class="section">
      <div class="label">Issue Description:</div>
      <div class="content">${issue}</div>
    </div>

    <div class="section">
      <div class="label">Steps to Reproduce:</div>
      <div class="content">${steps}</div>
    </div>

    ${expected ? `
    <div class="section">
      <div class="label">Expected Result:</div>
      <div class="content">${expected}</div>
    </div>
    ` : ''}

    ${actual ? `
    <div class="section">
      <div class="label">Actual Result:</div>
      <div class="content">${actual}</div>
    </div>
    ` : ''}

    ${additionalNotes ? `
    <div class="section">
      <div class="label">Additional Notes:</div>
      <div class="content">${additionalNotes}</div>
    </div>
    ` : ''}

    <div class="section">
      <div class="label">Device Information:</div>
      <div class="content">${formatDeviceInfo(deviceInfo)}</div>
    </div>

    <div class="footer">
      <p>This bug report was submitted via the LPai mobile app.</p>
      <p>To view all bug reports, check the MongoDB collection: <code>lpai.bugreports</code></p>
    </div>
  </div>
</body>
</html>`;

      const emailText = `
New Bug Report Submitted

Report ID: ${reportId}
Reporter: ${reporterName}
Priority: ${priorityEmoji} ${priority || 'Medium'}
Screen: ${screen}
${component ? `Component: ${component}` : ''}

Issue:
${issue}

Steps to Reproduce:
${steps}

${expected ? `Expected Result:\n${expected}\n` : ''}
${actual ? `Actual Result:\n${actual}\n` : ''}
${additionalNotes ? `Additional Notes:\n${additionalNotes}\n` : ''}

Device Information:
${formatDeviceInfo(deviceInfo)}

---
Submitted: ${new Date().toLocaleString()}
View in MongoDB: lpai.bugreports
`;

      await resend.emails.send({
        from: 'LPai Bug Reports <info@fieldserv.ai>',
        to: [process.env.ADMIN_EMAIL || 'info@fieldserv.ai'],
        subject: emailSubject,
        html: emailHtml,
        text: emailText,
      });

      console.log(`[Bug Report] Email sent for report ${reportId}`);
    } catch (emailError) {
      // Log email error but don't fail the request
      console.error('[Bug Report] Failed to send email notification:', emailError);
    }

    // Return success response
    res.status(201).json({
      success: true,
      message: 'Bug report submitted successfully',
      reportId: reportId
    });

  } catch (error) {
    console.error('[Bug Report] Submission error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit bug report'
    });
  }
}