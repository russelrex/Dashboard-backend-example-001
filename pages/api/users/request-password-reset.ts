import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { EmailService } from '../../../src/utils/email/emailService';
import crypto from 'crypto';
import cors from '../../../src/lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Find user by email
    const user = await db.collection('users').findOne({
      email: email.toLowerCase().trim(),
      isDeleted: { $ne: true }
    });

    // SECURITY: Always return success even if user not found (don't leak user existence)
    if (!user) {
      console.log(`[Password Reset] User not found for email: ${email}`);
      return res.status(200).json({ 
        success: true, 
        message: 'If an account exists, a password reset email has been sent' 
      });
    }

    // Generate secure reset token (32 bytes = 64 hex characters)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store token on user document
    await db.collection('users').updateOne(
      { _id: user._id },
      {
        $set: {
          resetToken,
          resetTokenExpiry,
          updatedAt: new Date()
        }
      }
    );

    // Send password reset email
    const emailService = new EmailService();
    const resetUrl = `https://www.leadprospecting.ai/reset-password?token=${resetToken}`;

    await emailService.sendOnboardingEmail({
      to: user.email,
      subject: 'Reset Your FieldServ Ai Password',
      html: generatePasswordResetEmail({
        firstName: user.firstName || user.name?.split(' ')[0] || 'User',
        resetUrl,
        email: user.email
      })
    });

    console.log(`[Password Reset] Email sent to ${user.email}`);

    return res.status(200).json({
      success: true,
      message: 'If an account exists, a password reset email has been sent'
    });

  } catch (error: any) {
    console.error('[Password Reset] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to process password reset request',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

function generatePasswordResetEmail({
  firstName,
  resetUrl,
  email
}: {
  firstName: string;
  resetUrl: string;
  email: string;
}) {
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #FF6B35 0%, #F7931E 100%); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;">
        <div style="margin-bottom: 20px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
            <tr>
              <td style="text-align: center;">
                <img src="https://lpai-backend-omega.vercel.app/fsai-logo-no-bg.png" 
                     alt="FieldServ Ai" 
                     width="200" 
                     height="67" 
                     style="height: 67px; width: auto; filter: brightness(0) invert(1); display: block; max-width: 200px;"
                     border="0">
              </td>
            </tr>
          </table>
        </div>
        <h1 style="color: white; margin: 0; font-size: 32px; font-weight: 700;">Reset Your Password</h1>
      </div>
      
      <!-- Main Content -->
      <div style="padding: 40px 30px; background: white; border-radius: 0 0 12px 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
        <p style="font-size: 20px; color: #333; margin: 0 0 25px 0; font-weight: 600;">Hi ${firstName},</p>
        
        <p style="color: #555; line-height: 1.7; margin-bottom: 30px; font-size: 16px;">
          We received a request to reset the password for your FieldServ Ai account (<strong>${email}</strong>).
        </p>

        <!-- Reset CTA -->
        <div style="background: linear-gradient(135deg, #FFF8F5 0%, #FFF0E8 100%); padding: 30px; border-radius: 12px; text-align: center; margin: 30px 0; border: 1px solid #FFE4D6;">
          <h3 style="color: #333; margin: 0 0 15px 0; font-size: 20px;">🔐 Reset Your Password</h3>
          <p style="color: #666; margin-bottom: 25px; font-size: 14px;">Click the button below to choose a new password</p>
          
          <a href="${resetUrl}" 
             style="background: linear-gradient(135deg, #FF6B35 0%, #F7931E 100%); 
                    color: white; 
                    padding: 16px 40px; 
                    text-decoration: none; 
                    border-radius: 10px; 
                    font-weight: 600; 
                    font-size: 16px;
                    display: inline-block;
                    box-shadow: 0 6px 20px rgba(255, 107, 53, 0.3);
                    border: 2px solid #FF6B35;">
            Reset Password →
          </a>
          
          <p style="color: #888; font-size: 12px; margin: 20px 0 0 0;">🔒 This link expires in 1 hour</p>
        </div>

        <!-- Security Note -->
        <div style="background: #FFF0E8; padding: 25px; border-radius: 12px; margin-top: 30px; border: 1px solid #FFD4B8;">
          <h4 style="color: #E55100; margin: 0 0 15px 0;">⚠️ Didn't Request This?</h4>
          <p style="color: #555; margin: 0; line-height: 1.6;">
            If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
          </p>
        </div>

        <!-- Support -->
        <div style="text-align: center; margin-top: 30px;">
          <p style="color: #666; font-size: 14px;">
            Need help? Email us at <a href="mailto:support@fieldserv.ai" style="color: #FF6B35; font-weight: 600;">support@fieldserv.ai</a>
          </p>
        </div>
      </div>

      <!-- Footer -->
      <div style="text-align: center; padding: 30px; color: #888; font-size: 12px;">
        <p style="margin: 0;">FieldServ Ai - Field Service Management Platform</p>
      </div>
    </div>
  `;

  return html;
}
