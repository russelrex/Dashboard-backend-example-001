/**
 * File: send-email.ts
 * Purpose: Send invoice emails using existing email infrastructure
 * Author: LPai Team
 * Last Modified: 2025-09-18
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await clientPromise;
  const db = client.db(getDbName());

  try {
    const {
      invoiceId,
      paymentUrl,
      to,
      subject,
      message,
      htmlContent,
      amount,
      paymentMethods,
      locationId,
      projectTitle,
    } = req.body;

    console.log('[Invoice Email API] Sending invoice email:', {
      invoiceId,
      to,
      subject,
      amount,
      locationId,
      hasHtmlContent: !!htmlContent,
      hasPaymentUrl: !!paymentUrl
    });

    // Validate required fields
    if (!to || !subject || !locationId) {
      return res.status(400).json({ error: 'Missing required fields: to, subject, locationId' });
    }

    // Get location info for sender details
    const location = await db.collection('locations').findOne({ locationId });
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    // Get payment record if invoiceId provided
    let paymentRecord = null;
    if (invoiceId) {
      paymentRecord = await db.collection('payments').findOne({
        _id: new ObjectId(invoiceId),
        locationId
      });
    }

    // Prepare email content
    let finalHtmlContent = htmlContent || '';
    
    // If no HTML template provided, create a simple one
    if (!finalHtmlContent) {
      finalHtmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 28px;">Invoice for Payment</h1>
            <p style="margin: 10px 0 0; font-size: 16px; opacity: 0.9;">${projectTitle || 'Invoice'}</p>
          </div>
          
          <div style="background: #fff; padding: 30px; border: 1px solid #e2e8f0; border-radius: 0 0 8px 8px;">
            <div style="margin-bottom: 20px;">
              <p style="color: #059669; font-size: 18px; font-weight: 600;">Hi there,</p>
            </div>
            
            <div style="margin-bottom: 30px;">
              <p style="color: #374151; line-height: 1.6;">${message.replace(/\n/g, '<br>')}</p>
            </div>
            
            <div style="background: #f0fdf4; border-left: 4px solid #059669; padding: 20px; margin: 30px 0; border-radius: 0 8px 8px 0;">
              <h3 style="margin: 0 0 15px; color: #059669;">Invoice Details</h3>
              <p style="margin: 0; color: #374151;"><strong>Amount Due:</strong> $${amount.toFixed(2)}</p>
              <p style="margin: 5px 0 0; color: #374151;"><strong>Due Date:</strong> ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}</p>
            </div>
            
            ${paymentMethods?.cash || paymentMethods?.check || paymentMethods?.card ? `
              <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
                <h4 style="margin: 0 0 10px; color: #92400e;">Payment Methods Accepted:</h4>
                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                  ${paymentMethods?.cash ? '<span style="background: #fef3c7; color: #92400e; padding: 8px 12px; border-radius: 6px; font-size: 14px; border: 1px solid #fcd34d;">💵 Cash</span>' : ''}
                  ${paymentMethods?.check ? '<span style="background: #fef3c7; color: #92400e; padding: 8px 12px; border-radius: 6px; font-size: 14px; border: 1px solid #fcd34d;">📝 Check</span>' : ''}
                  ${paymentMethods?.card ? '<span style="background: #fef3c7; color: #92400e; padding: 8px 12px; border-radius: 6px; font-size: 14px; border: 1px solid #fcd34d;">💳 Credit Card</span>' : ''}
                </div>
              </div>
            ` : ''}
            
            ${paymentUrl ? `
              <div style="text-align: center; margin: 30px 0;">
                <a href="${paymentUrl}" style="background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 700; display: inline-block;">
                  Pay Online - $${amount.toFixed(2)}
                </a>
              </div>
            ` : ''}
            
            <div style="background: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 20px; margin: 30px 0; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; color: #075985; font-weight: 500;">
                <strong>Payment Instructions:</strong> ${paymentUrl ? 'You can pay online using the link above, or ' : ''}contact us to arrange ${paymentMethods?.cash ? 'cash' : ''}${paymentMethods?.cash && paymentMethods?.check ? ' or ' : ''}${paymentMethods?.check ? 'check' : ''} payment. ${invoiceId ? `Please reference invoice #${invoiceId} with your payment.` : ''}
              </p>
            </div>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; text-align: center;">
              <h4 style="margin: 0 0 10px; color: #059669;">Questions? We're Here to Help</h4>
              <p style="margin: 0; color: #6b7280; font-size: 14px;">
                Reply to this email or call us at ${location.phone || '(555) 123-4567'} for any questions about this invoice.
              </p>
              <p style="margin: 10px 0 0; color: #6b7280; font-size: 12px;">
                Thank you for choosing ${location.name || 'Your Company'}
              </p>
            </div>
          </div>
        </div>
      `;
    }

    // Use the existing email sending infrastructure (same as quotes/send-email)
    const senderName = location.contactName || location.name || 'Your Company';
    const senderEmail = process.env.ADMIN_EMAIL || 'noreply@fieldserv.ai';

    // Import the EmailService (same as other email endpoints)
    const { EmailService } = require('../../../src/utils/email/emailService');
    const emailService = new EmailService();

    // Send the email
    const emailResult = await emailService.sendEmail({
      from: `${senderName} <${senderEmail}>`,
      to: Array.isArray(to) ? to : [to],
      subject: subject,
      html: finalHtmlContent,
      text: message, // Plain text version
    });

    // Update payment record with email sent info
    if (paymentRecord) {
      await db.collection('payments').updateOne(
        { _id: new ObjectId(invoiceId) },
        {
          $set: {
            lastEmailSentAt: new Date(),
            emailsSentCount: (paymentRecord.emailsSentCount || 0) + 1,
            updatedAt: new Date()
          }
        }
      );
    }

    console.log('[Invoice Email API] Email sent successfully:', emailResult.messageId);

    return res.status(200).json({
      success: true,
      messageId: emailResult.messageId,
      sentAt: new Date().toISOString(),
      sentTo: to,
      message: 'Invoice email sent successfully'
    });

  } catch (error: any) {
    console.error('[Invoice Email API] Failed to send invoice email:', error);
    return res.status(500).json({
      error: 'Failed to send invoice email',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
}
