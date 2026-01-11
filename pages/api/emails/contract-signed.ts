/**
 * File: contract-signed.ts
 * Purpose: Send contract signed notifications to team using Resend
 * Author: LPai Team
 * Last Modified: 2025-09-18
 * Dependencies: Resend, hardcoded template
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Resend } from 'resend';
import cors from '@/lib/cors';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Add CORS and authentication like onboard/emails.ts
  await cors(req, res);
  
  // Add authentication check (same pattern as onboard/emails.ts)
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - Missing or invalid authorization header' });
  }
  
  // You can add JWT verification here if needed, or just check for valid format
  const token = authHeader.substring(7);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized - Invalid token' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { 
    to,
    recipientName,
    quoteNumber,
    projectTitle,
    customerName,
    contractValue,
    signedAt,
    notificationType
  } = req.body;

  if (!to || !quoteNumber || !customerName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ 
      error: 'Resend not configured. Please set RESEND_API_KEY.' 
    });
  }

  try {
    const template = generateContractSignedTemplate({
      recipientName,
      quoteNumber,
      projectTitle,
      customerName,
      contractValue,
      signedAt,
      notificationType
    });

    await resend.emails.send({
      from: 'LPai Team <info@leadprospecting.ai>',
      to: [to],
      subject: template.subject,
      html: template.html
    });

    console.log(`✅ [Contract Signed Email] Sent to: ${to} (${notificationType})`);

    return res.status(200).json({
      success: true,
      message: 'Contract signed notification sent successfully'
    });

  } catch (error: any) {
    console.error('[Contract Signed Email] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to send contract signed notification',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
}

function generateContractSignedTemplate({
  recipientName,
  quoteNumber,
  projectTitle,
  customerName,
  contractValue,
  signedAt,
  notificationType
}: {
  recipientName?: string;
  quoteNumber: string;
  projectTitle?: string;
  customerName: string;
  contractValue?: string;
  signedAt?: string;
  notificationType?: string;
}) {
  const displayName = recipientName || 'Team Member';
  const isLocationTeam = notificationType === 'location_team';
  
  const subject = `🎉 Contract Signed: ${quoteNumber} - ${projectTitle || 'New Project'}`;
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contract Signed - ${quoteNumber}</title>
  <style>
    body { 
      margin: 0; 
      padding: 0; 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
      background-color: #f8fafc; 
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: white;
      box-shadow: 0 4px 25px rgba(0,0,0,0.15);
      border-radius: 8px;
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 40px 30px;
      text-align: center;
      color: white;
    }
    .header h1 {
      margin: 0 0 10px 0;
      font-size: 28px;
      font-weight: 600;
      letter-spacing: -0.5px;
    }
    .header p {
      margin: 0;
      font-size: 16px;
      opacity: 0.9;
    }
    .content {
      padding: 40px 30px;
    }
    .greeting {
      font-size: 18px;
      color: #2d3748;
      margin-bottom: 24px;
      font-weight: 500;
    }
    .celebration {
      text-align: center;
      margin: 20px 0;
    }
    .celebration-emoji {
      font-size: 48px;
      margin-bottom: 16px;
    }
    .main-message {
      font-size: 18px;
      color: #2d3748;
      text-align: center;
      margin-bottom: 32px;
      line-height: 1.5;
    }
    .details-card {
      background: #f7fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 24px;
      margin: 24px 0;
    }
    .details-title {
      font-size: 18px;
      font-weight: 600;
      color: #2d3748;
      margin-bottom: 16px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid #e2e8f0;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-size: 14px;
      color: #718096;
      font-weight: 500;
    }
    .detail-value {
      font-size: 14px;
      color: #2d3748;
      font-weight: 600;
    }
    .contract-value {
      color: #38a169;
      font-size: 18px;
    }
    .next-steps {
      background: #e6fffa;
      border-left: 4px solid #38b2ac;
      padding: 16px 20px;
      margin: 24px 0;
      border-radius: 0 4px 4px 0;
    }
    .next-steps p {
      margin: 0;
      font-size: 14px;
      color: #2d3748;
      line-height: 1.5;
    }
    .footer {
      background: #f7fafc;
      padding: 24px 30px;
      text-align: center;
      border-top: 1px solid #e2e8f0;
    }
    .footer p {
      margin: 0;
      font-size: 12px;
      color: #a0aec0;
    }
    .company-info {
      margin-top: 8px;
      font-size: 12px;
      color: #718096;
    }
    @media only screen and (max-width: 600px) {
      .container { margin: 0; border-radius: 0; }
      .header { padding: 30px 20px; }
      .content { padding: 30px 20px; }
      .details-card { padding: 16px; margin: 16px 0; }
      .detail-row { flex-direction: column; align-items: flex-start; }
      .detail-value { margin-top: 4px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Contract Signed!</h1>
      <p>Quote ${quoteNumber}</p>
    </div>
    
    <div class="content">
      <div class="greeting">Hi ${displayName},</div>
      
      <div class="celebration">
        <div class="celebration-emoji">🎉</div>
      </div>
      
      <div class="main-message">
        <strong>${customerName}</strong> just signed the contract for <strong>${projectTitle || 'this project'}</strong>!
      </div>
      
      <div class="details-card">
        <div class="details-title">Contract Details</div>
        <div class="detail-row">
          <span class="detail-label">Quote Number</span>
          <span class="detail-value">${quoteNumber}</span>
        </div>
        ${projectTitle ? `
        <div class="detail-row">
          <span class="detail-label">Project</span>
          <span class="detail-value">${projectTitle}</span>
        </div>
        ` : ''}
        <div class="detail-row">
          <span class="detail-label">Customer</span>
          <span class="detail-value">${customerName}</span>
        </div>
        ${contractValue ? `
        <div class="detail-row">
          <span class="detail-label">Contract Value</span>
          <span class="detail-value contract-value">${contractValue}</span>
        </div>
        ` : ''}
        ${signedAt ? `
        <div class="detail-row">
          <span class="detail-label">Signed On</span>
          <span class="detail-value">${signedAt}</span>
        </div>
        ` : ''}
      </div>
      
      <div class="next-steps">
        <p><strong>Next Steps:</strong> 
          ${isLocationTeam ? 
            'The project has been moved to active jobs. Coordinate with your team to begin work.' : 
            'Check the LPai app to begin project coordination and scheduling.'
          }
        </p>
      </div>
    </div>
    
    <div class="footer">
      <p>This notification was sent automatically when the contract was signed.</p>
      <div class="company-info">
        FieldServ AI • Automated Project Management
      </div>
    </div>
  </div>
</body>
</html>
  `;

  return { subject, html };
}
