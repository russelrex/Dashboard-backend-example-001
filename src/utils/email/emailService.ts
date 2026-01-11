// /src/utils/email/emailService.ts
import { Resend } from 'resend';

export class EmailService {
  private resend: Resend;
  private static emailQueue: Array<() => Promise<void>> = [];
  private static isProcessing = false;
  private static lastEmailTime = 0;
  private static readonly MIN_DELAY_MS = 500; // 2 emails per second = 500ms between emails

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }
  
  async sendReport(options: {
    to: string[];
    subject: string;
    html: string;
  }): Promise<void> {
    try {
      const { data, error } = await this.resend.emails.send({
        from: 'LPai Reports <reports@leadprospecting.ai>',
        to: options.to,
        subject: options.subject,
        html: options.html
      });
      
      if (error) {
        console.error('[Email Service] Failed to send report:', error);
        throw error;
      }
      
      console.log('[Email Service] Report sent successfully:', data);
    } catch (error) {
      console.error('[Email Service] Error sending email:', error);
      throw error;
    }
  }

  async sendEmail(options: {
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    try {
      const { data, error } = await this.resend.emails.send({
        from: 'FieldServ Ai <noreply@leadprospecting.ai>',
        to: options.to,
        subject: options.subject,
        html: options.html
      });
      
      if (error) {
        console.error('[Email Service] Failed to send email:', error);
        throw error;
      }
      
      console.log('[Email Service] Email sent successfully:', data);
    } catch (error) {
      console.error('[Email Service] Error sending email:', error);
      throw error;
    }
  }

  /**
   * Process email queue with rate limiting (max 2 per second)
   */
  private static async processEmailQueue() {
    if (EmailService.isProcessing || EmailService.emailQueue.length === 0) {
      return;
    }

    EmailService.isProcessing = true;

    while (EmailService.emailQueue.length > 0) {
      const now = Date.now();
      const timeSinceLastEmail = now - EmailService.lastEmailTime;

      // Wait if we're sending too fast
      if (timeSinceLastEmail < EmailService.MIN_DELAY_MS) {
        await new Promise(resolve => 
          setTimeout(resolve, EmailService.MIN_DELAY_MS - timeSinceLastEmail)
        );
      }

      const emailFn = EmailService.emailQueue.shift();
      if (emailFn) {
        try {
          await emailFn();
          EmailService.lastEmailTime = Date.now();
        } catch (error) {
          console.error('[Email Service] Error processing queued email:', error);
        }
      }
    }

    EmailService.isProcessing = false;
  }

  /**
   * Queue an email to be sent with rate limiting
   */
  private async queueEmail(emailFn: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      EmailService.emailQueue.push(async () => {
        try {
          await emailFn();
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      // Start processing if not already running
      EmailService.processEmailQueue();
    });
  }

  async sendOnboardingEmail(options: {
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    try {
      // Convert logo to base64 for CID embedding
      const fs = await import('fs');
      const path = await import('path');
      
      // Read your PNG logo (convert SVG to PNG first)
      const logoPath = path.join(process.cwd(), 'public', 'fsai-logo-no-bg.png');
      let logoBuffer;
      try {
        logoBuffer = fs.readFileSync(logoPath);
      } catch {
        logoBuffer = null; // Fallback if logo file missing
      }

      const emailData: any = {
        from: 'LeadProspecting Ai <info@leadprospecting.ai>',
        to: options.to,
        subject: options.subject,
        html: options.html.replace(
          'https://lpai-backend-omega.vercel.app/fsai-logo-no-bg.svg',
          'cid:fieldserv-logo'
        )
      };

      // Add CID attachment if logo exists
      if (logoBuffer) {
        emailData.attachments = [{
          content: logoBuffer.toString('base64'),
          filename: 'fieldserv-logo.png',
          content_id: 'fieldserv-logo',
          content_type: 'image/png'
        }];
      }

      // Queue the email to respect rate limits
      await this.queueEmail(async () => {
        const { data, error } = await this.resend.emails.send(emailData);
        
        if (error) {
          console.error('[Email Service] Failed to send onboarding email:', error);
          throw error;
        }
        
        console.log('[Email Service] Onboarding email sent successfully:', data);
      });
    } catch (error) {
      console.error('[Email Service] Error sending onboarding email:', error);
      throw error;
    }
  }
}