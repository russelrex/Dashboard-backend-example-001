// pages/api/quotes/send-email.ts
// Updated: 2025-10-10 - Using GHL API for email sending
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import cors from '@/lib/cors';
import jwt from 'jsonwebtoken';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    // Verify JWT token
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { 
      quoteId, 
      to, 
      cc,
      subject, 
      message, 
      htmlContent,
      includePDF = false,
      webLink,
    } = req.body;

    if (!quoteId || !to || !subject) {
      return res.status(400).json({ error: 'Missing required fields: quoteId, to, subject' });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Get quote
    const quote = await db.collection('quotes').findOne({
      _id: new ObjectId(quoteId)
    });
    
    console.log('[Quote Email API] Quote lookup result:', {
      quoteId,
      found: !!quote,
      collection: 'quotes'
    });
    
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    // Get contact (REQUIRED for GHL)
    const contact = await db.collection('contacts').findOne({
      _id: new ObjectId(quote.contactId),
      locationId: quote.locationId
    });

    if (!contact || !contact.ghlContactId) {
      return res.status(400).json({ 
        error: 'Contact missing GHL contact ID',
        details: 'Cannot send email without GHL integration'
      });
    }

    console.log('[Quote Email API] Contact found:', {
      contactId: contact._id,
      ghlContactId: contact.ghlContactId,
      email: contact.email
    });

    // Verify user access
    let userQuery: any = { locationId: quote.locationId };
    
    if (decoded.userId) {
      if (ObjectId.isValid(decoded.userId)) {
        userQuery.$or = [
          { _id: new ObjectId(decoded.userId) },
          { ghlUserId: decoded.userId },
          { userId: decoded.userId }
        ];
      } else {
        userQuery.$or = [
          { ghlUserId: decoded.userId },
          { userId: decoded.userId },
          { email: decoded.email }
        ];
      }
    }

    const user = await db.collection('users').findOne(userQuery);

    if (!user) {
      console.error('[Quote Email API] User not found for decoded token:', decoded);
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get location/company info
    const location = await db.collection('locations').findOne({
      locationId: quote.locationId
    });

    if (!location?.ghlOAuth?.accessToken) {
      return res.status(400).json({ 
        error: 'Location GHL OAuth token not found',
        details: 'Cannot send email without GHL integration'
      });
    }

    const companyName = location?.name || location?.business?.name || 'Your Company';
    const senderEmail = location?.email || location?.business?.email || process.env.ADMIN_EMAIL || 'noreply@yourcompany.com';
    const senderName = `${user.firstName} ${user.lastName}`.trim() || companyName;

    // Build email content
    let emailSubject = subject || `Quote ${quote.quoteNumber} - ${quote.title}`;
    let emailHTML;

    if (htmlContent && htmlContent.trim() !== '') {
      // Use frontend-provided HTML
      console.log('[Quote Email API] Using pre-processed HTML from frontend');
      emailHTML = htmlContent;
    } else {
      // Load template from database
      console.log('[Quote Email API] Loading template from database');
      
      let template = null;
      try {
        // Note: This looks in 'emailTemplates' but new templates are in 'email_templates'
        // TODO: Standardize collection name across the app
        template = await db.collection('email_templates').findOne({
          category: 'quote',
          locationId: quote.locationId,
          isActive: true
        });
        
        if (!template) {
          template = await db.collection('email_templates').findOne({
            category: 'quote',
            isActive: true
          });
        }
      } catch (templateError) {
        console.warn('[Quote Email API] Failed to load template:', templateError);
      }
      
      if (template && template.html) {
        console.log('[Quote Email API] Using database template:', template.name);
        
        // Generate conditional logo variable
        const locationLogo = location?.logo?.public 
          ? `<img src="${location.logo.public}" alt="${location.name}" class="header-logo" />`
          : '';

        // Generate conditional social media icon variables
        const facebookIcon = location?.facebookUrl
          ? `<a href="${location.facebookUrl}" title="Facebook"><img src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/facebook.svg" alt="Facebook" style="width: 40px; height: 40px; background: #1877F2; padding: 10px; border-radius: 50%;" /></a>`
          : '';
        
        const instagramIcon = location?.instagramUrl
          ? `<a href="${location.instagramUrl}" title="Instagram"><img src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/instagram.svg" alt="Instagram" style="width: 40px; height: 40px; background: linear-gradient(45deg, #f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%); padding: 10px; border-radius: 50%;" /></a>`
          : '';
        
        const linkedinIcon = location?.linkedinUrl
          ? `<a href="${location.linkedinUrl}" title="LinkedIn"><img src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/linkedin.svg" alt="LinkedIn" style="width: 40px; height: 40px; background: #0A66C2; padding: 10px; border-radius: 50%;" /></a>`
          : '';
        
        const twitterIcon = location?.twitterUrl
          ? `<a href="${location.twitterUrl}" title="Twitter"><img src="https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/x.svg" alt="X/Twitter" style="width: 40px; height: 40px; background: #000000; padding: 10px; border-radius: 50%;" /></a>`
          : '';

        // Build comprehensive template variables with double-brace format
        const templateVars = {
          // Contact variables
          'contact.firstName': contact?.firstName || 'Customer',
          'contact.lastName': contact?.lastName || '',
          'contact.fullName': `${contact?.firstName || ''} ${contact?.lastName || ''}`.trim() || 'Customer',
          'contact.email': contact?.email || '',
          'contact.phone': contact?.phone || '',
          
          // Quote variables
          'quote.number': quote.quoteNumber || '',
          'quote.title': quote.title || '',
          'quote.total': quote.total ? `$${quote.total.toLocaleString()}` : '$0',
          'quote.validUntil': quote.validUntil ? new Date(quote.validUntil).toLocaleDateString() : 'Please inquire',
          'quote.viewUrl': quote.webLinkToken 
            ? `https://www.fieldserv.ai/quote/${quote.webLinkToken}`
            : `https://www.fieldserv.ai/quote/${quote._id}`,
          'quote.pdfUrl': includePDF && quote.webLinkToken 
            ? `https://lpai-backend-omega.vercel.app/api/quotes/public/download-pdf?token=${quote.webLinkToken}`
            : '',
          'pdfButton': includePDF && quote.webLinkToken
            ? `<a href="https://lpai-backend-omega.vercel.app/api/quotes/public/download-pdf?token=${quote.webLinkToken}" class="cta-button secondary" style="display: inline-block; background: #059669 !important; color: white !important; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 700; margin-right: 15px; font-size: 16px;">Download PDF</a>`
            : '',
          
          // Location variables
          'location.name': location?.name || 'Your Company',
          'location.phone': location?.phone || '',
          'location.email': location?.email || '',
          
          // User variables (sender)
          'user.firstName': user?.firstName || '',
          'user.lastName': user?.lastName || '',
          'user.fullName': `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Your Team',
          
          // Logo and social icons (conditional)
          'locationLogo': locationLogo,
          'facebookIcon': facebookIcon,
          'instagramIcon': instagramIcon,
          'linkedinIcon': linkedinIcon,
          'twitterIcon': twitterIcon,
          
          // Legacy single-brace variables for backward compatibility
          'customMessage': message || '',
          'firstName': contact?.firstName || 'Customer',
          'quoteNumber': quote.quoteNumber || '',
          'projectTitle': quote.title || '',
          'totalAmount': `$${quote.total?.toLocaleString() || '0'}`,
          'validUntil': quote.validUntil ? new Date(quote.validUntil).toLocaleDateString() : 'Please inquire',
          'webLink': quote.webLinkToken 
            ? `https://www.fieldserv.ai/quote/${quote.webLinkToken}`
            : `https://www.fieldserv.ai/quote/${quote._id}`,
          'companyPhone': location?.phone || ''
        };

        // Replace variables - handle both {{double}} and {single} brace formats
        let processedHtml = template.html;
        Object.entries(templateVars).forEach(([key, value]) => {
          // Replace {{key}} format (new templates)
          const doubleBraceRegex = new RegExp(`\\{\\{${key.replace('.', '\\.')}\\}\\}`, 'g');
          processedHtml = processedHtml.replace(doubleBraceRegex, value || '');
          
          // Replace {key} format (legacy templates)
          const singleBraceRegex = new RegExp(`\\{${key}\\}`, 'g');
          processedHtml = processedHtml.replace(singleBraceRegex, value || '');
        });
        
        // CRITICAL: Hide PDF button if no PDF URL (after variable replacement)
        // Find any <a> tag with href="{{quote.pdfUrl}}" or href="" and add display:none if empty
        if (!includePDF || !(quote.r2PdfUrl || quote.pdfUrl)) {
          // Hide PDF download buttons with empty or placeholder hrefs
          processedHtml = processedHtml.replace(
            /(<a[^>]*href=["'](?:{{quote\.pdfUrl}}|["'])[^>]*class=["'][^"']*cta-button[^"']*secondary[^"']*["'][^>]*)(>)/gi,
            '$1 style="display:none"$2'
          );
          
          // Also handle buttons that may already have inline styles
          processedHtml = processedHtml.replace(
            /(<a[^>]*href=["'](?:{{quote\.pdfUrl}}|["'])[^>]*class=["'][^"']*cta-button[^"']*secondary[^"']*["'][^>]*style=["'])([^"']*)["']/gi,
            '$1$2; display:none;"'
          );
        }
        
        emailHTML = processedHtml;
      } else {
        // Fallback simple template
        console.log('[Quote Email API] Using simple template');
        emailHTML = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Quote ${quote.quoteNumber}</h2>
            
            <div style="margin: 20px 0;">
              ${message ? message.replace(/\n/g, '<br>') : 'Thank you for your interest in our services. Please find your quote details below.'}
            </div>
            
            <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3>Quote Summary</h3>
              <p><strong>Quote Number:</strong> ${quote.quoteNumber}</p>
              <p><strong>Project:</strong> ${quote.title}</p>
              <p><strong>Total Amount:</strong> $${quote.total?.toLocaleString() || '0'}</p>
              <p><strong>Valid Until:</strong> ${quote.validUntil ? new Date(quote.validUntil).toLocaleDateString() : 'Please inquire'}</p>
            </div>
            
            ${webLink ? `
              <div style="text-align: center; margin: 30px 0;">
                <a href="${webLink}" style="background: #2E86AB; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
                  View Quote Online
                </a>
              </div>
            ` : ''}
            
            ${includePDF && quote.webLinkToken ? `
              <div style="text-align: center; margin: 20px 0;">
                <a href="https://lpai-backend-omega.vercel.app/api/quotes/public/download-pdf?token=${quote.webLinkToken}" style="background: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
                  Download PDF
                </a>
              </div>
            ` : ''}
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              <p style="color: #666; font-size: 14px;">
                Best regards,<br>
                ${companyName}
              </p>
            </div>
          </div>
        `;
      }
    }

    // Send email via GHL API
    console.log('[Quote Email] Sending via GHL to:', contact.email);

    const ghlPayload = {
      type: 'Email',
      contactId: contact.ghlContactId,  // MUST use GHL contact ID
      subject: emailSubject,
      html: emailHTML
    };

    const response = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${location.ghlOAuth.accessToken}`,
        'Version': '2021-04-15',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(ghlPayload)
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('[Quote Email] GHL API error:', errorData);
      throw new Error(`GHL API error: ${response.status} - ${response.statusText}`);
    }

    const result = await response.json();
    
    console.log('[Quote Email] Sent successfully via GHL. Message ID:', result.messageId);

    // Log email sent
    await db.collection('quote_emails').insertOne({
      quoteId: quote._id,
      quoteNumber: quote.quoteNumber,
      locationId: quote.locationId,
      to: [to],
      cc: cc || [],
      subject: emailSubject,
      includedPDF: includePDF,
      webLink: webLink,
      sentBy: user._id,
      sentAt: new Date(),
      messageId: result.messageId || result.message?.id,
      provider: 'ghl'
    });

    // Update quote
    await db.collection('quotes').updateOne(
      { _id: new ObjectId(quoteId) },
      { 
        $set: { 
          lastEmailSentAt: new Date(),
          status: quote.status === 'draft' ? 'sent' : quote.status,
          sentTo: to,
          sentCc: cc || [],
        },
        $inc: { emailsSentCount: 1 },
        $push: {
          activityFeed: {
            action: 'email_sent',
            timestamp: new Date(),
            userId: user._id,
            metadata: {
              sentTo: [to],
              cc: cc || [],
              emailId: result.messageId || result.message?.id
            }
          }
        }
      }
    );

    // Emit quote-sent automation event
    try {
      const { AutomationEventListener } = await import('../../../src/services/automationEventListener');
      const automationEventListener = new AutomationEventListener(db);
      await automationEventListener.emitQuoteSent({
        ...quote,
        sentAt: new Date(),
        lastEmailSentAt: new Date(),
        emailsSentCount: (quote.emailsSentCount || 0) + 1
      });
      console.log('[Email API] Quote-sent automation event triggered');
    } catch (automationError) {
      console.error('[Email API] Failed to trigger quote-sent automation:', automationError);
    }

    res.status(200).json({ 
      success: true, 
      message: 'Email sent successfully via GHL',
      messageId: result.messageId || result.message?.id,
      sentTo: to,
      sentCc: cc || []
    });

  } catch (err: any) {
    console.error('❌ Failed to send quote email:', err);
    res.status(500).json({ 
      error: 'Failed to send email',
      details: err.message 
    });
  }
}