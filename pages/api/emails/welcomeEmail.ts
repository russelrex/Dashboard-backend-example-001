// pages/api/emails/welcomeEmail.ts
// Welcome email API for user onboarding
// Created: January 2025

import type { NextApiRequest, NextApiResponse } from 'next';
import { EmailService } from '../../../src/utils/email/emailService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { 
    email,
    firstName,
    lastName,
    businessName,
    setupToken,
    setupUrl,
    customMessage
  } = req.body;

  if (!email || !firstName) {
    return res.status(400).json({ error: 'Missing required fields: email, firstName' });
  }

  // Check if we have Resend configured
  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ 
      error: 'Email service not configured. Please set RESEND_API_KEY.' 
    });
  }

  const requestId = Date.now().toString();

  try {

    // Use EmailService to send email
    const emailService = new EmailService();

    // Generate welcome email template
    const template = generateWelcomeEmailTemplate({
      firstName,
      lastName,
      businessName: businessName || 'LPai',
      setupToken,
      setupUrl,
      customMessage
    });

    // Send email via EmailService
    await emailService.sendOnboardingEmail({
      to: email,
      subject: template.subject,
      html: template.html
    });


    return res.status(200).json({
      success: true,
      message: 'Welcome email sent successfully',
      method: 'EmailService',
      requestId
    });

  } catch (error: any) {
    
    return res.status(500).json({ 
      error: 'Failed to send welcome email',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      requestId
    });
  }
}

// Generate welcome email HTML template
function generateWelcomeEmailTemplate({
  firstName,
  lastName,
  businessName,
  setupToken,
  setupUrl,
  customMessage
}: {
  firstName: string;
  lastName?: string;
  businessName: string;
  setupToken?: string;
  setupUrl?: string;
  customMessage?: string;
}) {
  const fullName = lastName ? `${firstName} ${lastName}` : firstName;
  const companyDisplayName = businessName || 'your company';
  const actionUrl = setupUrl || `https://app.fieldserv.ai/setup-password?token=${setupToken || 'placeholder'}`;
  
  const subject = `Welcome to FieldServ Ai, ${firstName}! 🎉`;
  
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #FF6B35 0%, #F7931E 100%); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;">
        <div style="margin-bottom: 20px;">
          <!-- FieldServ Ai Logo -->
        <div style="margin: 0 auto 15px auto; text-align: center; display: flex; justify-content: center; align-items: center;">
          <!-- Logo with fallback text -->
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
            <tr>
              <td style="text-align: center;">
                <img src="https://lpai-backend-omega.vercel.app/fsai-logo-no-bg.png" 
                     alt="FieldServ Ai" 
                     width="200" 
                     height="67" 
                     style="height: 67px; width: auto; filter: brightness(0) invert(1); display: block; max-width: 200px;"
                     border="0">
                <!--[if !mso]><!-->
                <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
                  <span style="color: white; font-size: 24px; font-weight: bold; letter-spacing: 2px;">
                    ⚡ FIELDSERV Ai
                  </span>
                </div>
                <!--<![endif]-->
              </td>
            </tr>
          </table>
        </div>
        </div>
        <h1 style="color: white; margin: 0; font-size: 32px; font-weight: 700;">Welcome to FieldServ Ai!</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 15px 0 0 0; font-size: 18px;">Installation complete for ${companyDisplayName}</p>
      </div>
      
      <!-- Main Content -->
      <div style="padding: 40px 30px; background: white; border-radius: 0 0 12px 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
        <p style="font-size: 20px; color: #333; margin: 0 0 25px 0; font-weight: 600;">Hi ${companyDisplayName},</p>
        
        <p style="color: #555; line-height: 1.7; margin-bottom: 30px; font-size: 16px;">
          Great news! FieldServ Ai has been successfully installed for <strong>${companyDisplayName}</strong>. 
          ${customMessage || 'Your field service management platform is ready and we\'ve set up everything you need to streamline your operations.'}
        </p>

        <!-- User Setup Info -->
        <div style="background: linear-gradient(135deg, #E3F2FD 0%, #BBDEFB 100%); padding: 30px; border-radius: 12px; text-align: center; margin: 30px 0; border: 1px solid #90CAF9;">
          <h3 style="color: #1565C0; margin: 0 0 15px 0; font-size: 20px;">📧 User Account Setup</h3>
          <p style="color: #666; margin-bottom: 0; font-size: 14px;">All users in your GoHighLevel account will receive individual emails shortly with instructions to set up their passwords and access FieldServ Ai.</p>
        </div>

        <!-- Mobile App Section -->
        <div style="background: #FFF8F5; padding: 30px; border-radius: 12px; margin: 30px 0; border: 1px solid #FFE4D6;">
          <h3 style="color: #333; margin: 0 0 20px 0; font-size: 20px; text-align: center;">📱 Download the FieldServ Ai App</h3>
          <p style="color: #555; margin-bottom: 25px; text-align: center; font-size: 15px;">Manage your field operations on the go!</p>
          
          <div style="text-align: center; margin-bottom: 20px;">
<div style="text-align: center;">
  <a href="https://apps.apple.com/us/app/fieldserv-ai/id6748652835" 
     style="display: inline-block; margin: 0 10px; vertical-align: top;">
    <img src="https://lpai-backend-omega.vercel.app/app-store-badge.png" 
         alt="Download on App Store" 
         style="height: 50px; width: auto; display: block;" 
         width="120" height="40">
  </a>
  <a href="https://play.google.com/store/apps/details?id=com.fieldservai.app" 
     style="display: inline-block; margin: 0 10px; vertical-align: top;">
    <img src="https://lpai-backend-omega.vercel.app/google-play-badge.png" 
         alt="Get it on Google Play" 
         style="height: 75px; width: auto; display: block;" 
         width="129" height="50">
  </a>
</div>
          </div>
        </div>

        <!-- What's Set Up -->
        <div style="margin: 30px 0;">
          <h3 style="color: #333; margin: 0 0 20px 0; font-size: 20px;">✨ What's Ready For You:</h3>
          <ul style="color: #555; line-height: 1.8; padding-left: 20px;">
            <li>Job scheduling and dispatch</li>
            <li>Customer management and quotes</li>
            <li>Field team location tracking</li>
            <li>Automated follow-ups and notifications</li>
            <li>Integration with your GoHighLevel account</li>
          </ul>
        </div>

        <!-- Support -->
        <div style="background: #FFF0E8; padding: 25px; border-radius: 12px; text-align: center; border: 1px solid #FFD4B8;">
          <h4 style="color: #E55100; margin: 0 0 15px 0;">Need Help?</h4>
          <p style="color: #555; margin: 0;">
            Email us at <a href="mailto:support@fieldserv.ai" style="color: #FF6B35; font-weight: 600;">support@fieldserv.ai</a>
          </p>
        </div>
      </div>

      <!-- Footer -->
      <div style="text-align: center; padding: 30px; color: #888; font-size: 12px;">
        <p style="margin: 0;">FieldServ Ai - Field Service Management & Automation Platform</p>
        <p style="margin: 5px 0 0 0; color: #AAA;">Streamlining field operations for service businesses</p>
      </div>
    </div>
  `;

  return { subject, html };
} 