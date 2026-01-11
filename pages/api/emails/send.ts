// lpai-backend/pages/api/emails/send.ts
//Updated Date 06/24/2025

import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';

const logger = {
  info: (action: string, data: any) => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      action,
      ...data
    }));
  },
  error: (action: string, error: any, context: any) => {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      action,
      error: error.message || error,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      ...context
    }));
  }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { 
    contactId, 
    contactObjectId, // NEW: Accept both field names
    locationId, 
    subject,
    htmlContent,
    plainTextContent,
    attachments = [],
    appointmentId,
    projectId,
    userId,
    replyToMessageId
  } = req.body;

  // NEW: Use contactObjectId if provided, otherwise use contactId for backward compatibility
  const finalContactId = contactObjectId || contactId;

  if (!finalContactId || !locationId || !subject) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const requestId = new ObjectId().toString();

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Get location for API key
    const location = await db.collection('locations').findOne({ locationId });
    if (!location?.ghlOAuth?.accessToken) {
      logger.error('EMAIL_SEND_NO_API_KEY', new Error('No API key found'), {
        requestId,
        locationId
      });
      return res.status(400).json({ error: 'No API key found for location' });
    }

    // Get contact with better error handling and logging
    logger.info('EMAIL_SEND_CONTACT_LOOKUP', {
      requestId,
      contactId: finalContactId,
      contactIdType: typeof finalContactId,
      locationId,
      locationIdType: typeof locationId
    });

    const contact = await db.collection('contacts').findOne({ 
      _id: new ObjectId(finalContactId),
      locationId 
    });

    // Enhanced logging for debugging
    if (!contact) {
      // Try finding contact without locationId to see if it exists at all
      const contactWithoutLocation = await db.collection('contacts').findOne({ 
        _id: new ObjectId(finalContactId)
      });
      
      logger.error('EMAIL_SEND_NO_CONTACT', new Error('Contact not found with locationId filter'), {
        requestId,
        contactId: finalContactId,
        locationId,
        contactExistsWithoutLocationFilter: !!contactWithoutLocation,
        contactLocationId: contactWithoutLocation?.locationId
      });

      return res.status(400).json({ 
        error: 'Contact not found',
        details: `Contact ${finalContactId} not found for location ${locationId}`,
        requestId 
      });
    }

    if (!contact.ghlContactId) {
      logger.error('EMAIL_SEND_NO_GHL_ID', new Error('Contact missing GHL contact ID'), {
        requestId,
        contactId: finalContactId,
        contactData: {
          id: contact._id,
          email: contact.email,
          hasGhlId: !!contact.ghlContactId
        }
      });
      
      return res.status(400).json({ 
        error: 'Contact missing GHL contact ID',
        details: 'Cannot send email without GHL integration',
        requestId 
      });
    }

    logger.info('EMAIL_SEND_CONTACT_FOUND', {
      requestId,
      contactId: contact._id,
      ghlContactId: contact.ghlContactId,
      email: contact.email
    });

    // Validate and prepare attachments for GHL format (URL strings only)
    const validAttachments = [];
    if (attachments && Array.isArray(attachments)) {
      for (const attachment of attachments) {
        let attachmentUrl = '';
        
        if (typeof attachment === 'string') {
          attachmentUrl = attachment;
        } else if (attachment.url) {
          attachmentUrl = attachment.url;
        }
        
        if (attachmentUrl) {
          try {
            const urlCheck = new URL(attachmentUrl);
            // GHL API might only accept URL strings, not objects
            validAttachments.push(attachmentUrl);
            logger.info('EMAIL_SEND_ATTACHMENT_ADDED', {
              requestId,
              filename: (typeof attachment === 'object' ? attachment.filename : 'attachment') || 'attachment',
              url: attachmentUrl.substring(0, 100) + '...'
            });
          } catch (urlError) {
            logger.error('EMAIL_SEND_INVALID_ATTACHMENT_URL', urlError, {
              requestId,
              filename: (typeof attachment === 'object' ? attachment.filename : 'unknown') || 'unknown',
              invalidUrl: attachmentUrl
            });
          }
        }
      }
    }

    // Process template if templateId is provided
    let processedHtmlContent = htmlContent;

    if (req.body.templateId && req.body.templateId !== '') {
      try {
        console.log('[Email Send API] Processing template:', req.body.templateId);
        
        // Load the selected template - use correct collection name
        const selectedTemplate = await db.collection('email_templates').findOne({
          _id: new ObjectId(req.body.templateId),
          locationId: locationId,
          isActive: true
        });

        if (selectedTemplate && selectedTemplate.html) {
          console.log('[Email Send API] Using template:', selectedTemplate.name);
          
          // Replace variables in template HTML - support nested variables with dot notation
          processedHtmlContent = selectedTemplate.html.replace(/{{([^}]+)}}/g, (match: string, key: string) => {
            // Handle nested variables like invoice.number, contact.firstName, etc.
            const keys = key.split('.');
            
            const replacements: { [key: string]: any } = {
              // Contact variables
              'contact.firstName': req.body['contact.firstName'] || contact.firstName || 'there',
              'contact.lastName': req.body['contact.lastName'] || contact.lastName || '',
              'contact.email': req.body['contact.email'] || contact.email || '',
              'contact.phone': req.body['contact.phone'] || contact.phone || '',
              
              // Invoice variables - CRITICAL: Check dot notation keys FIRST
              'invoice.number': req.body['invoice.number'] || req.body.invoiceNumber || 'INV-001',
              'invoice.title': req.body['invoice.title'] || req.body.projectTitle || req.body.invoiceTitle || 'Your Project',
              'invoice.total': req.body['invoice.total'] || req.body.totalAmount || req.body.invoiceTotal || '$0',
              'invoice.dueDate': req.body['invoice.dueDate'] || req.body.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
              'invoice.paymentUrl': req.body['invoice.paymentUrl'] || req.body.paymentUrl || req.body.invoicePaymentUrl || '',
              
              // Generate conditional payment button based on whether URL exists AND credit card is accepted
              'invoice.paymentButton': (() => {
                const paymentUrl = req.body['invoice.paymentUrl'] || req.body.paymentUrl || req.body.invoicePaymentUrl;
                const paymentMethods = req.body['payment.methods'] || req.body.paymentMethods || '';
                
                // Check if Credit Card is in the payment methods string
                const acceptsCreditCard = paymentMethods.toLowerCase().includes('credit card') || 
                                         paymentMethods.includes('💳');
                
                if (paymentUrl && paymentUrl !== '' && paymentUrl !== '#' && acceptsCreditCard) {
                  return `<center><a href="${paymentUrl}" class="cta-button" style="display: inline-block; padding: 16px 32px; background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Pay Online Now</a></center>`;
                } else {
                  return '<center><p style="color: #6b7280; font-size: 14px; margin: 20px 0;">Online payment not available for this invoice</p></center>';
                }
              })(),
              
              // Payment variables
              'payment.methods': req.body['payment.methods'] || req.body.paymentMethods || 'Cash, Check, Credit Card',
              
              // Location variables
              'location.name': req.body['location.name'] || location?.companyName || location?.name || 'Your Company',
              'location.phone': req.body['location.phone'] || location?.phone || '',
              'location.email': req.body['location.email'] || location?.email || '',
              
              // Logo and social icons (these should be HTML already)
              'locationLogo': req.body.locationLogo || '',
              'facebookIcon': req.body.facebookIcon || '',
              'instagramIcon': req.body.instagramIcon || '',
              'linkedinIcon': req.body.linkedinIcon || '',
              'twitterIcon': req.body.twitterIcon || '',
              
              // Quote variables (backward compatibility)
              'quoteNumber': req.body.quoteNumber || 'N/A',
              'projectTitle': req.body.projectTitle || 'Your Project',
              'totalAmount': req.body.totalAmount || '$0',
              'validUntil': req.body.validUntil || 'Please inquire',
              'companyName': location?.companyName || location?.name || 'Your Company',
              'companyPhone': location?.phone || '',
              'companyEmail': location?.email || '',
              'webLink': req.body.webLink || '',
              'pdfLink': req.body.pdfLink || '',
              
              // Simple firstName for backward compatibility
              'firstName': contact.firstName || 'there',
              'lastName': contact.lastName || ''
            };
            
            // Try full key first (e.g., "invoice.number")
            if (replacements[key]) {
              console.log(`[Email Send API] Replacing {{${key}}} with:`, replacements[key]);
              return replacements[key];
            }
            
            // If not found, return original
            console.log(`[Email Send API] No replacement found for {{${key}}}, keeping original`);
            return match;
          });

          // Replace the message area with user's custom content if provided
          if (htmlContent) {
            processedHtmlContent = processedHtmlContent.replace(
              /<div[^>]*class="message"[^>]*>[\s\S]*?<\/div>/, 
              `<div class="message">${htmlContent}</div>`
            );
          }
        } else {
          console.warn('[Email Send API] Template not found, using original HTML');
        }
      } catch (templateError) {
        console.error('[Email Send API] Template processing error:', templateError);
        // Continue with original HTML if template processing fails
      }
    } else {
      console.log('[Email Send API] No template selected, using original HTML');
    }

    // Ensure HTML content is properly formatted (use processed content)
    let formattedHtmlContent = processedHtmlContent;
    if (processedHtmlContent && !processedHtmlContent.toLowerCase().includes('<html') && !processedHtmlContent.toLowerCase().includes('<body')) {
      formattedHtmlContent = `<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">${processedHtmlContent}</body>`;
    }

    // Send email via GHL Conversations API
    const ghlPayload = {
      type: 'Email',
      contactId: contact.ghlContactId,
      subject: subject,
      html: formattedHtmlContent || plainTextContent, // Prioritize HTML
      text: plainTextContent,
      attachments: validAttachments // GHL expects array of URL strings
    };

    logger.info('EMAIL_SEND_ATTEMPT', {
      requestId,
      locationId,
      contactId: contact._id.toString(),
      ghlContactId: contact.ghlContactId,
      subject,
      hasAttachments: validAttachments.length > 0,
      attachmentCount: validAttachments.length,
      attachmentFilenames: attachments
        .filter((a: any) => (typeof a === 'object' && a.filename) || typeof a === 'string')
        .map((a: any) => typeof a === 'string' ? 'attachment.pdf' : (a.filename || 'attachment'))
    });

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
      logger.error('EMAIL_SEND_GHL_ERROR', new Error(`GHL API error: ${response.status}`), {
        requestId,
        status: response.status,
        statusText: response.statusText,
        errorPreview: errorData.substring(0, 200),
        ghlPayloadSummary: {
          contactId: contact.ghlContactId,
          subject: subject,
          hasHtml: !!htmlContent,
          hasText: !!plainTextContent,
          attachmentCount: validAttachments.length
        }
      });
      throw new Error(`GHL API error: ${response.status} - ${response.statusText}`);
    }

    const result = await response.json();
    const messageId = result.messageId || result.conversationId || result.id;

    if (!messageId) {
      logger.error('EMAIL_SEND_NO_MESSAGE_ID', new Error('No message ID returned from GHL'), {
        requestId,
        ghlResponse: result
      });
      throw new Error('Email sent but no message ID returned');
    }

    // Find or create email conversation with contactObjectId
    const conversationRecord = {
      locationId,
      contactObjectId: new ObjectId(finalContactId),    // Use the resolved contact ID
      ghlContactId: contact.ghlContactId,          // ADD: Store GHL contact ID
      ghlConversationId: result.conversationId,    // Store GHL conversation ID
      type: 'TYPE_EMAIL',                           // Use TYPE_EMAIL for consistency
      lastMessageAt: new Date(),
      lastMessageDate: new Date(),                  // Add both fields
      lastMessagePreview: subject.substring(0, 100),
      lastMessageBody: plainTextContent?.substring(0, 200) || htmlContent?.substring(0, 200) || '',
      lastMessageDirection: 'outbound',
      lastMessageType: 'TYPE_EMAIL',
      unreadCount: 0,
      updatedAt: new Date(),
      // Contact info (denormalized for performance)
      contactName: contact.fullName || `${contact.firstName} ${contact.lastName}`,
      contactEmail: contact.email,
      contactPhone: contact.phone
    };

    logger.info('EMAIL_SEND_CONVERSATION_UPSERT', {
      requestId,
      conversationQuery: {
        locationId,
        contactObjectId: finalContactId,
        type: 'TYPE_EMAIL'
      }
    });

    const conversation = await db.collection('conversations').findOneAndUpdate(
      { 
        locationId,
        contactObjectId: new ObjectId(finalContactId),  // Use the resolved contact ID
        type: 'TYPE_EMAIL'                          // Use TYPE_EMAIL
      },
      {
        $set: conversationRecord,
        $setOnInsert: {
          createdAt: new Date(),
          dateAdded: new Date(),
          _id: new ObjectId(),
          inbox: true,
          starred: false,
          tags: [],
          followers: [],
          scoring: []
        }
      },
      { 
        upsert: true,
        returnDocument: 'after'
      }
    );

    // Check if conversation was created/updated successfully  
    // Note: conversation.value is the updated document, conversation itself might be the result
    let conversationId;
    let conversationDoc;
    
    if (conversation && conversation.value) {
      // Standard case - result has .value property
      conversationDoc = conversation.value;
      conversationId = conversation.value._id;
    } else if (conversation && conversation._id) {
      // Alternative case - result is the document itself
      conversationDoc = conversation;
      conversationId = conversation._id;
    } else {
      logger.error('EMAIL_SEND_CONVERSATION_FAILED', new Error('Failed to create/update conversation'), {
        requestId,
        conversationResult: conversation,
        conversationKeys: conversation ? Object.keys(conversation) : 'null',
        hasValue: !!(conversation && conversation.value),
        hasDirectId: !!(conversation && conversation._id)
      });
      throw new Error('Failed to create conversation record');
    }

    logger.info('EMAIL_SEND_CONVERSATION_SUCCESS', {
      requestId,
      conversationId: conversationId.toString(),
      conversationFound: !!conversationDoc
    });

    // Add email to messages collection
    const messageRecord = {
      _id: new ObjectId(),
      conversationId: conversationId,       // Use the verified conversation ID
      ghlConversationId: result.conversationId,    // Store GHL conversation ID
      locationId,
      contactObjectId: new ObjectId(finalContactId),    // Use the resolved contact ID
      ghlContactId: contact.ghlContactId,          // ADD: Store GHL contact ID
      ghlMessageId: messageId,
      direction: 'outbound',
      type: 3,                                      // Numeric type for Email
      messageType: 'TYPE_EMAIL',                    // String type
      subject: subject,
      body: plainTextContent || '',                 // Store plain text in body
      htmlBody: htmlContent || '',                  // Store HTML separately
      attachments: validAttachments,               // Use validated attachments, not raw attachments
      status: 'sent',
      sentBy: userId,
      sentAt: new Date(),
      dateAdded: new Date(),
      read: true,
      source: 'app',
      replyToMessageId: replyToMessageId || null,
      metadata: {
        appointmentId: appointmentId || null,
        projectId: projectId || null,
        requestId
      }
    };

    await db.collection('messages').insertOne(messageRecord);

    // Update appointment if provided
    if (appointmentId) {
      await db.collection('appointments').updateOne(
        { _id: new ObjectId(appointmentId) },
        {
          $push: {
            communications: {
              type: 'email',
              subject,
              sentAt: new Date(),
              sentBy: userId,
              messageId: messageRecord._id
            }
          },
          $set: {
            lastCommunication: new Date()
          }
        }
      );
    }

    // Update project timeline if provided
    if (projectId) {
      await db.collection('projects').updateOne(
        { _id: new ObjectId(projectId) },
        {
          $push: {
            timeline: {
              id: new ObjectId().toString(),
              event: 'email_sent',
              description: `Email sent: ${subject}`,
              timestamp: new Date().toISOString(),
              userId,
              metadata: {
                messageId: messageRecord._id.toString(),
                subject,
                to: contact.email
              }
            }
          }
        }
      );
    }

    logger.info('EMAIL_SEND_SUCCESS', {
      requestId,
      messageId,
      conversationId: conversationId.toString(),
      locationId,
      contactId: contact._id.toString()
    });

    return res.status(200).json({
      success: true,
      messageId,
      conversationId: conversationId,
      message: 'Email sent successfully'
    });

  } catch (error: any) {
    logger.error('EMAIL_SEND_FAILED', error, {
      requestId,
      locationId,
      contactId: finalContactId,
      ghlError: error.response?.data
    });
    
    return res.status(500).json({ 
      error: 'Failed to send email',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      requestId
    });
  }
}