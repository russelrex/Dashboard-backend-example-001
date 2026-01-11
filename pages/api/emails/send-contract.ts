// pages/api/emails/send-contract.ts
// Updated for template-based PDFs with your existing R2 setup

import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const client = await clientPromise;
  const db = client.db(getDbName());

  try {
    const {
      quoteId,
      locationId,
      contactId,
      pdfFileId, // Optional - will auto-generate if needed
      quoteData,
      companyData,
      // Enhanced fields
      customSubject,
      customMessage,
      emailFrom,
      templateName = 'Contract Signed', // Default template name
      regeneratePDF = false // Force new PDF generation
    } = req.body;

    console.log('[Send Contract API] Starting template-based email send:', {
      quoteId,
      locationId,
      contactId,
      hasCustomSubject: !!customSubject,
      hasCustomMessage: !!customMessage,
      emailFrom,
      templateName,
      regeneratePDF
    });

    // Validate required fields
    if (!quoteId || !locationId || !contactId) {
      return res.status(400).json({ 
        error: 'Missing required fields: quoteId, locationId, contactId' 
      });
    }

    // Get location data
    const location = await db.collection('locations').findOne({ locationId });
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    if (!location.ghlOAuth?.accessToken) {
      return res.status(400).json({ error: 'Location missing GHL access token' });
    }

    // Get contact data
    const contact = await db.collection('contacts').findOne({ 
      _id: new ObjectId(contactId),
      locationId 
    });
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    if (!contact.ghlContactId) {
      return res.status(400).json({ error: 'Contact missing GHL ID' });
    }

    // Get full quote data
    let fullQuoteData = quoteData;
    if (!fullQuoteData) {
      const quote = await db.collection('quotes').findOne({
        _id: new ObjectId(quoteId),
        locationId
      });
      
      if (!quote) {
        return res.status(404).json({ error: 'Quote not found' });
      }
      
      fullQuoteData = quote;
    }

    // Build company data
    const locationCompanyData = {
      name: location.name || '',
      phone: location.branding?.phone || location.phone || '',
      email: location.branding?.email || location.email || '',
      address: location.branding?.address || location.address || '',
      ...location.companyInfo,
      ...companyData
    };

    // Build comprehensive variables for template replacement
    const variables = {
      // Contact variables
      'contact.firstName': contact.firstName || '',
      'contact.lastName': contact.lastName || '',
      'contact.fullName': `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
      'contact.email': contact.email || '',
      'contact.phone': contact.phone || '',
      
      // Quote variables
      'quote.number': fullQuoteData.quoteNumber || '',
      'quote.title': fullQuoteData.title || '',
      'quote.total': fullQuoteData.total ? `$${fullQuoteData.total.toLocaleString()}` : '$0',
      'quote.totalRaw': fullQuoteData.total || 0,
      'quote.depositAmount': fullQuoteData.depositAmount ? `$${fullQuoteData.depositAmount.toLocaleString()}` : '',
      
      // Project variables (if linked)
      'project.title': fullQuoteData.title || fullQuoteData.projectTitle || '',
      'project.serviceType': fullQuoteData.serviceType || 'service',
      
      // Company variables
      'company.name': locationCompanyData.name || '',
      'company.phone': locationCompanyData.phone || '',
      'company.email': locationCompanyData.email || '',
      'company.address': locationCompanyData.address || '',
      
      // Consultant variables
      'consultant.name': locationCompanyData.consultantName || locationCompanyData.name || '',
      
      // Legacy variables for backward compatibility
      ...buildEmailVariables(fullQuoteData, locationCompanyData, contact)
    };
    
    // Get email template
    const template = await getEmailTemplate(db, locationId, templateName);
    
    if (!template) {
      return res.status(404).json({ 
        error: 'Email template configuration error',
        message: `No email template found for "${templateName}". Please contact support to configure email templates.`,
        templateName: templateName,
        locationId: locationId
      });
    }

    // Handle PDF attachment with smart generation
    let attachments = [];
    let usedPdfUrl = null;
    
    // Check if we need to generate a new PDF
    const needsNewPDF = regeneratePDF || 
                       !fullQuoteData.r2PdfUrl || 
                       !fullQuoteData.r2StorageEnabled ||
                       (pdfFileId && pdfFileId !== fullQuoteData.r2PdfFileId);

    if (needsNewPDF) {
      console.log('[Send Contract API] Generating new PDF...');
      
      try {
        // Generate new PDF using the template system
        const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 
                       (process.env.API_BASE_URL || 'https://lpai-backend-omega.vercel.app');
        const pdfResponse = await fetch(`${baseUrl}/api/quotes/${quoteId}/pdf-optimized?locationId=${locationId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(req.headers.authorization && { 'Authorization': req.headers.authorization }), // Pass through auth if available
          },
          body: JSON.stringify({ locationId })
        });

        if (pdfResponse.ok) {
          const pdfResult = await pdfResponse.json();
          if (pdfResult.success && pdfResult.pdf?.url) {
            usedPdfUrl = pdfResult.pdf.url;
            console.log('[Send Contract API] New PDF generated:', usedPdfUrl);
            
            // Update the quote data with new PDF info
            fullQuoteData.r2PdfUrl = pdfResult.pdf.url;
            fullQuoteData.r2PdfFileId = pdfResult.pdf.fileId;
          }
        } else {
          console.warn('[Send Contract API] PDF generation failed, checking for existing PDF');
        }
      } catch (pdfError) {
        console.warn('[Send Contract API] PDF generation error:', pdfError);
      }
    }

    // Use existing PDF if available and no new one was generated
    if (!usedPdfUrl && fullQuoteData.r2PdfUrl && fullQuoteData.r2StorageEnabled) {
      usedPdfUrl = fullQuoteData.r2PdfUrl;
      console.log('[Send Contract API] Using existing R2 PDF:', usedPdfUrl);
    }

    // Add PDF attachment if we have a URL
    if (usedPdfUrl) {
      attachments.push({
        url: usedPdfUrl,
        filename: `Quote-${fullQuoteData.quoteNumber}.pdf`
      });
    } else {
      console.warn('[Send Contract API] No PDF available for attachment');
    }

    // Determine sender email
    const senderEmail = emailFrom || 
                       location.branding?.email || 
                       location.email || 
                       'info@leadprospecting.ai';

    // Send enhanced email
    let emailResult;
    
    try {
      emailResult = await sendEnhancedGHLEmail({
        apiKey: location.ghlOAuth.accessToken,
        contactId: contact.ghlContactId,
        template,
        variables,
        attachments,
        customSubject,
        customMessage,
        emailFrom: senderEmail
      });
      
      console.log('[Send Contract API] Email sent successfully using template:', template.name);
      
    } catch (error) {
      console.error('[Send Contract API] Failed to send email:', error);
      throw error;
    }

    // Log comprehensive activity
    await logEmailActivity(db, quoteId, {
      action: templateName === 'Contract Signed' ? 'contract_emailed' : 'quote_emailed',
      success: true,
      templateUsed: template.name,
      templateId: template._id,
      isGlobalTemplate: template.isGlobal || false,
      emailId: emailResult.emailId,
      sentTo: contact.email,
      sentAt: new Date().toISOString(),
      sentFrom: senderEmail,
      hadCustomSubject: !!customSubject,
      hadCustomMessage: !!customMessage,
      attachmentCount: attachments.length,
      attachmentUrls: attachments.map(a => a.url),
      pdfGenerated: needsNewPDF,
      pdfUrl: usedPdfUrl,
      ghlContactId: contact.ghlContactId,
      locationId: locationId
    });

    console.log('[Send Contract API] Email sent successfully');
    
    return res.status(200).json({
      success: true,
      emailId: emailResult.emailId,
      templateUsed: template.name,
      sentAt: new Date().toISOString(),
      sentTo: contact.email,
      sentFrom: senderEmail,
      attachments: attachments.map(a => ({ filename: a.filename, url: a.url })),
      pdfGenerated: needsNewPDF,
      pdfUrl: usedPdfUrl
    });

  } catch (error: any) {
    console.error('[Send Contract API] Error:', error);
    
    if (error.message?.includes('template')) {
      return res.status(404).json({ 
        error: 'Email template not found',
        details: 'The "Quote Sent" email template is missing for this location'
      });
    }
    
    // Log error activity if possible
    if (req.body.quoteId) {
      try {
        await logEmailActivity(db, req.body.quoteId, {
          action: 'email_send_failed',
          success: false,
          error: error.message,
          errorStack: error.stack,
          attemptedAt: new Date().toISOString(),
          templateName: req.body.templateName || 'Unknown'
        });
      } catch (logError) {
        console.error('[Send Contract API] Failed to log error activity:', logError);
      }
    }
    
    return res.status(500).json({ 
      error: 'Failed to send contract email',
      details: error.message 
    });
  }
}

/**
 * Get email template with system default fallback
 */
async function getEmailTemplate(db: any, locationId: string, templateName: string) {
  console.log('[Email Template] Looking for template:', templateName, 'for location:', locationId);
  
  // 1. Check for location custom template
  const location = await db.collection('locations').findOne({ locationId });
  
  const templateFieldMap = {
    'Contract Signed': 'contractSigned',
    'Quote Sent': 'quoteSent',
    'Invoice Sent': 'invoiceSent'
  };
  
  const templateField = templateFieldMap[templateName as keyof typeof templateFieldMap];
  const customTemplateId = location?.emailTemplates?.[templateField];
  
  if (customTemplateId) {
    try {
      const customTemplate = await db.collection('emailTemplates').findOne({
        _id: new ObjectId(customTemplateId),
        isActive: true
      });
      
      if (customTemplate) {
        console.log('[Email Template] Using location custom template:', customTemplate.name);
        return customTemplate;
      }
    } catch (error) {
      console.warn('[Email Template] Failed to load custom template:', error);
    }
  }
  
  // 2. Check for location-specific template by name (try multiple collection names)
  let locationTemplate = await db.collection('emailTemplates').findOne({
    locationId: locationId,
    name: templateName,
    isActive: true
  });

  if (!locationTemplate) {
    locationTemplate = await db.collection('email_templates').findOne({
      locationId: locationId,
      name: templateName,
      isActive: true
    });
  }

  if (!locationTemplate) {
    // Try category-based lookup
    locationTemplate = await db.collection('emailTemplates').findOne({
      locationId: locationId,
      category: 'quote',
      isActive: true
    });
  }

  if (locationTemplate) {
    console.log('[Email Template] Found location template:', locationTemplate.name);
    return locationTemplate;
  }
  
  // 3. Check for global template
  const globalTemplate = await db.collection('emailTemplates').findOne({
    locationId: 'global',
    name: templateName,
    isGlobal: true,
    isActive: true
  });
  
  if (globalTemplate) {
    console.log('[Email Template] Found global template:', globalTemplate.name);
    return globalTemplate;
  }
  
  // 4. Use system default as last resort
  const systemDefault = await db.collection('email_templates').findOne({
    locationId: 'SYSTEM_DEFAULT',
    name: templateName,
    isSystemDefault: true,
    isActive: true
  });
  
  if (systemDefault) {
    console.log('[Email Template] Using system default template:', systemDefault.name);
    return systemDefault;
  }
  
  return null;
}

/**
 * Enhanced GHL email sending (same as before but with better logging)
 */
async function sendEnhancedGHLEmail({
  apiKey,
  contactId,
  template,
  variables,
  attachments = [],
  customSubject,
  customMessage,
  emailFrom
}: any) {
  // Replace variables in subject and HTML
  let subject = customSubject || template.subject;
  let html = customMessage || template.html;
  
  // Safely process template variables with proper structure detection
  const templateVariables = template.variables || [];
  
  // Debug: Log template structure to understand the format
  console.log('[Email Template] Template variables structure:', {
    hasVariables: !!template.variables,
    variablesType: typeof template.variables,
    variablesLength: Array.isArray(template.variables) ? template.variables.length : 'not array',
    sampleVariable: Array.isArray(template.variables) && template.variables.length > 0 ? template.variables[0] : 'none'
  });
  
  // Handle different possible structures for template.variables
  if (Array.isArray(templateVariables)) {
    templateVariables.forEach((variable, index) => {
      let variableName = '';
      
      // Handle different variable object structures
      if (typeof variable === 'string') {
        variableName = variable;
      } else if (variable && typeof variable === 'object') {
        variableName = variable.name || variable.key || variable.variable || variable;
      } else {
        console.warn(`[Email Template] Unknown variable structure at index ${index}:`, variable);
        return;
      }
      
      if (!variableName) {
        console.warn(`[Email Template] Empty variable name at index ${index}:`, variable);
        return;
      }
      
      const variableValue = variables[variableName] || '';
      
      if (subject && variableName) {
        subject = subject.replace(
          new RegExp(`{{${variableName}}}`, 'g'),
          variableValue
        );
      }
      
      if (html && variableName) {
        html = html.replace(
          new RegExp(`{{${variableName}}}`, 'g'),
          variableValue
        );
      }
    });
  } else if (templateVariables && typeof templateVariables === 'object') {
    // Handle case where variables is an object instead of array
    Object.entries(templateVariables).forEach(([key, value]) => {
      const variableName = key;
      const variableValue = variables[variableName] || '';
      
      if (subject && variableName) {
        subject = subject.replace(
          new RegExp(`{{${variableName}}}`, 'g'),
          variableValue
        );
      }
      
      if (html && variableName) {
        html = html.replace(
          new RegExp(`{{${variableName}}}`, 'g'),
          variableValue
        );
      }
    });
  }
  
  // Process all standard variable formats
  Object.entries(variables).forEach(([key, value]) => {
    const patterns = [
      new RegExp(`{${key}}`, 'g'),
      new RegExp(`{{${key}}}`, 'g'),
      new RegExp(`{${key.replace('.', '\\.')}}`, 'g'), // Handle dot notation
      new RegExp(`{{${key.replace('.', '\\.')}}}`, 'g')
    ];
    
    patterns.forEach(pattern => {
      if (subject) {
        subject = subject.replace(pattern, value || '');
      }
      if (html) {
        html = html.replace(pattern, value || '');
      }
    });
  });

  console.log('[Email Template] Variables replaced. Subject preview:', subject.substring(0, 100));

  // Ensure we have content for GHL
  if (!html || html.trim() === '') {
    html = `Your quote ${variables.quoteNumber || 'is ready'}. Please find the details attached.`;
  }
  if (!subject || subject.trim() === '') {
    subject = `Quote ${variables.quoteNumber || ''} - ${variables.companyName || 'Your Company'}`;
  }

  if (customMessage) {
    html = customMessage.replace(/\n/g, '<br>');
  }

  const payload = {
    type: 'Email',
    contactId: contactId,
    subject: subject,
    html: html,
    emailFrom: emailFrom,
    attachments: attachments
  };

  console.log('[GHL Email Enhanced] Sending email:', {
    subject: subject.substring(0, 50) + '...',
    hasAttachments: attachments.length > 0,
    emailFrom,
    attachmentCount: attachments.length
  });

  if (attachments.length > 0) {
    console.log('[GHL Email Enhanced] Attachments:', attachments.map((a: any) => ({
      filename: a.filename,
      url: a.url.includes('files.leadprospecting.ai') ? 'R2 URL' : 'Other URL'
    })));
  }

  const response = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-04-15',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorData = await response.text();
    console.error('[GHL Email Enhanced] Failed response:', {
      status: response.status,
      statusText: response.statusText,
      errorData: errorData.substring(0, 500)
    });
    
    if (response.status === 401) {
      throw new Error('GHL authentication failed. Check access token.');
    } else if (response.status === 422) {
      throw new Error(`GHL validation error: ${errorData}`);
    } else {
      throw new Error(`GHL email send failed: ${response.status} ${errorData}`);
    }
  }

  const result = await response.json();
  console.log('[GHL Email Enhanced] Success response:', {
    messageId: result.messageId,
    conversationId: result.conversationId,
    success: true
  });
  
  return {
    emailId: result.messageId || result.conversationId || result.id || 'ghl_email_sent',
    provider: 'ghl_enhanced_template',
    ghlResponse: result
  };
}

/**
 * Build email variables (enhanced version)
 */
function buildEmailVariables(quoteData: any, companyData: any, contact: any) {
  // Ensure all required data exists
  const safeContact = contact || {};
  const safeQuoteData = quoteData || {};
  const safeCompanyData = companyData || {};
  
  const currentYear = new Date().getFullYear();
  const establishedYear = parseInt(safeCompanyData?.establishedYear || currentYear.toString());
  const experienceYears = Math.max(0, currentYear - establishedYear);

  return {
    // Contact variables - add comprehensive null checks
    firstName: safeContact?.firstName || safeQuoteData?.customerName?.split(' ')[0] || 'Valued Customer',
    lastName: safeContact?.lastName || safeQuoteData?.customerName?.split(' ').slice(1).join(' ') || '',
    fullName: `${safeContact?.firstName || ''} ${safeContact?.lastName || ''}`.trim() || safeQuoteData?.customerName || 'Valued Customer',
    email: safeContact?.email || '',
    phone: safeContact?.phone || '',
    
    // Quote variables - add null checks
    quoteNumber: safeQuoteData?.quoteNumber || 'Q-XXXX-XXX',
    customerName: safeQuoteData?.customerName || `${safeContact?.firstName || ''} ${safeContact?.lastName || ''}`.trim() || 'Valued Customer',
    projectTitle: safeQuoteData?.projectTitle || safeQuoteData?.title || 'Your Project',
    totalAmount: safeQuoteData?.total ? `$${safeQuoteData.total.toLocaleString()}` : '$0',
    subtotalAmount: safeQuoteData?.subtotal ? `$${safeQuoteData.subtotal.toLocaleString()}` : '$0',
    taxAmount: safeQuoteData?.tax ? `$${safeQuoteData.tax.toLocaleString()}` : '$0',
    
    // Company variables - add null checks  
    companyName: safeCompanyData?.name || 'Your Company',
    companyPhone: safeCompanyData?.phone || '',
    companyEmail: safeCompanyData?.email || '',
    companyAddress: safeCompanyData?.address || '',
    establishedYear: safeCompanyData?.establishedYear || currentYear.toString(),
    warrantyYears: safeCompanyData?.warrantyYears || '1',
    experienceYears: experienceYears.toString(),
    
    // Dates
    currentDate: new Date().toLocaleDateString(),
    quoteDate: safeQuoteData?.createdAt ? new Date(safeQuoteData.createdAt).toLocaleDateString() : new Date().toLocaleDateString(),
    validUntil: safeQuoteData?.validUntil ? new Date(safeQuoteData.validUntil).toLocaleDateString() : 'Please inquire',
    
    // Status
    quoteStatus: safeQuoteData?.status || 'Draft',
    itemCount: safeQuoteData?.sections?.reduce((total: number, section: any) => total + (section.lineItems?.length || 0), 0) || 0,
    
    // Custom
    projectDescription: safeQuoteData?.description || safeQuoteData?.projectTitle || 'Your Project',
    hasSignatures: !!(safeQuoteData?.signatures?.consultant && safeQuoteData?.signatures?.customer),
  };
}

/**
 * Enhanced activity logging
 */
async function logEmailActivity(db: any, quoteId: string, activityData: any) {
  const activity = {
    ...activityData,
    timestamp: new Date().toISOString(),
    id: new ObjectId().toString(),
    apiVersion: '2.0',
    source: 'send-contract-api-template',
    userAgent: 'LPai-Backend-Template'
  };

  await db.collection('quotes').updateOne(
    { _id: new ObjectId(quoteId) },
    {
      $push: {
        activityFeed: activity
      },
      $set: {
        lastEmailActivity: {
          action: activityData.action,
          timestamp: activity.timestamp,
          success: activityData.success
        }
      }
    }
  );

  console.log('[Email Activity] Logged activity:', {
    quoteId,
    action: activityData.action,
    success: activityData.success,
    timestamp: activity.timestamp
  });
}