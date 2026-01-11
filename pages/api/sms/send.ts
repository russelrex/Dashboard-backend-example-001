// lpai-backend/pages/api/sms/send.ts
//Updated Date 06/24/2025

import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '../../../src/lib/cors';
import { ObjectId } from 'mongodb';
import axios from 'axios';
import { processTemplate, UNIVERSAL_TEMPLATES } from './templates';
import { publishAblyEvent } from '../../../src/utils/ably/publishEvent';

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
  await cors(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { 
    contactId, 
    locationId, 
    templateKey,
    customMessage,
    fromNumber, // Optional override - defaults to user's phone
    toNumber,   // Optional override - defaults to contact's phone
    appointmentId, 
    projectId,
    userId,
    dynamicData
  } = req.body;

  if (!contactId || !locationId || (!templateKey && !customMessage)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const requestId = new ObjectId().toString();

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Get location for API key
    const location = await db.collection('locations').findOne({ locationId });
    if (!location?.ghlOAuth?.accessToken) {
      logger.error('SMS_SEND_NO_API_KEY', new Error('No API key found'), {
        requestId,
        locationId
      });
      return res.status(400).json({ error: 'No API key found for location' });
    }

    // Get contact
    const contact = await db.collection('contacts').findOne({ 
      _id: new ObjectId(contactId),
      locationId 
    });

    if (!contact) {
      logger.error('SMS_SEND_NO_CONTACT', new Error('Contact not found'), {
        requestId,
        contactId,
        locationId
      });
      return res.status(404).json({ error: 'Contact not found' });
    }

    if (!contact.ghlContactId) {
      logger.error('SMS_SEND_NO_GHL_ID', new Error('Contact missing GHL ID'), {
        requestId,
        contactId,
        locationId
      });
      return res.status(400).json({ error: 'Contact missing GHL ID' });
    }

    // Get user for phone number and name
    const user = userId ? await db.collection('users').findOne({ 
      _id: new ObjectId(userId) 
    }) : null;

    // ✅ RESOLVE FROM NUMBER
    let fromNumber;

    console.log('🔍 [SMS Send] Starting number resolution...', {
      userId: req.body.userId,
      locationId: req.body.locationId
    });

    // Priority 1: User's SMS number
    if (req.body.userId) {
      try {
        const user = await db.collection('users').findOne({ 
          _id: new ObjectId(req.body.userId) 
        });
        
        const userSmsNumberId = user?.preferences?.communication?.smsNumberId;
        
        console.log('📱 User SMS preference:', {
          hasPreferences: !!user?.preferences,
          smsNumberId: userSmsNumberId,
          allComm: user?.preferences?.communication
        });
        
        if (userSmsNumberId) {
          // ✅ CRITICAL: Query location correctly
          const location = await db.collection('locations').findOne({ 
            locationId: req.body.locationId 
          });
          
          console.log('🏢 Location query result:', {
            found: !!location,
            locationId: location?.locationId,
            hasSettings: !!location?.settings,
            hasSmsNumbers: !!location?.settings?.smsPhoneNumbers,
            smsNumbersCount: location?.settings?.smsPhoneNumbers?.length || 0
          });
          
          // ✅ CRITICAL: Check BOTH possible paths
          const smsNumbers = location?.settings?.smsPhoneNumbers || 
                            location?.smsPhoneNumbers || 
                            [];
          
          console.log('📋 Available SMS numbers:', {
            count: smsNumbers.length,
            numbers: smsNumbers.map((n: any) => ({
              _id: n._id?.toString(),
              label: n.label,
              number: n.number
            }))
          });
          
          const userPreferredNumber = smsNumbers.find((num: any) => {
            const numId = num._id?.toString();
            const searchId = userSmsNumberId.toString();
            console.log('  🔎 Comparing:', { numId, searchId, match: numId === searchId });
            return numId === searchId;
          });
          
          if (userPreferredNumber) {
            fromNumber = userPreferredNumber.number;
            console.log('✅ Using user preferred SMS number:', {
              label: userPreferredNumber.label,
              number: fromNumber
            });
          } else {
            console.log('⚠️  SMS number ID not found:', userSmsNumberId);
          }
        }
      } catch (error) {
        console.error('❌ Error resolving user SMS preference:', error);
      }
    }

    // Priority 2: Location default
    if (!fromNumber) {
      try {
        const location = await db.collection('locations').findOne({ 
          locationId: req.body.locationId 
        });
        
        const smsNumbers = location?.settings?.smsPhoneNumbers || 
                          location?.smsPhoneNumbers || 
                          [];
        
        console.log('🔍 Location default search:', {
          totalNumbers: smsNumbers.length,
          hasDefault: smsNumbers.some((n: any) => n.isDefault)
        });
        
        const defaultNumber = smsNumbers.find((n: any) => n.isDefault === true);
        
        if (defaultNumber) {
          fromNumber = defaultNumber.number;
          console.log('✅ Using location default:', {
            label: defaultNumber.label,
            number: fromNumber
          });
        } else if (smsNumbers.length > 0) {
          fromNumber = smsNumbers[0].number;
          console.log('⚠️  No default, using first:', fromNumber);
        }
      } catch (error) {
        console.error('❌ Error fetching location:', error);
      }
    }

    // Priority 3: Error
    if (!fromNumber) {
      console.error('❌ No SMS number configured', {
        locationId: req.body.locationId,
        userId: req.body.userId
      });
      
      return res.status(400).json({ 
        success: false, 
        error: 'No SMS number configured for this location' 
      });
    }

    console.log('📤 Final SMS from number:', fromNumber);

    // Continue with sending SMS using fromNumber...
    const finalFromNumber = fromNumber;
    const finalToNumber = toNumber || contact?.phone || '';

    if (!finalToNumber) {
      logger.error('SMS_SEND_NO_PHONE', new Error('No recipient phone number'), {
        requestId,
        contactId,
        hasFromNumber: !!finalFromNumber
      });
      return res.status(400).json({ error: 'Contact has no phone number' });
    }

    // Build message
    let message = customMessage || '';
    
    if (templateKey && !customMessage) {
      // Get the template (with any customizations)
      const templatesResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://lpai-backend-omega.vercel.app'}/api/sms/templates?locationId=${locationId}&userId=${userId}`);
      const { templates } = await templatesResponse.json();
      
      const template = templates[templateKey];
      if (!template) {
        logger.error('SMS_SEND_NO_TEMPLATE', new Error('Template not found'), {
          requestId,
          templateKey,
          locationId
        });
        return res.status(400).json({ error: 'Template not found' });
      }

      // Get related data for template processing
      const appointment = appointmentId ? await db.collection('appointments').findOne({
        _id: new ObjectId(appointmentId)
      }) : null;

      const project = projectId ? await db.collection('projects').findOne({
        _id: new ObjectId(projectId)
      }) : null;

      // Process template with all available data
      message = processTemplate(template.message, {
        user,
        location,
        contact,
        appointment,
        project,
        dynamic: dynamicData || {}
      });
    }

    // Log the attempt
    logger.info('SMS_SEND_ATTEMPT', {
      requestId,
      locationId,
      contactId: contact._id.toString(),
      templateKey: templateKey || 'custom',
      fromNumber: finalFromNumber ? 'provided' : 'missing',
      toNumber: finalToNumber ? 'provided' : 'missing',
      messageLength: message.length
    });

    // Send SMS via GHL using exact format from docs
    const options = {
      method: 'POST',
      url: 'https://services.leadconnectorhq.com/conversations/messages',
      headers: {
        Authorization: `Bearer ${location.ghlOAuth.accessToken}`,
        Version: '2021-04-15',
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      data: {
        type: 'SMS',
        contactId: contact.ghlContactId,
        message: message,
        fromNumber: finalFromNumber,
        toNumber: finalToNumber
      }
    };

    const { data: ghlResponse } = await axios.request(options);
    const messageId = ghlResponse.messageId || ghlResponse.conversationId || ghlResponse.id;

    // Create/update conversation with better error handling
    let conversationId;
    let conversation;

    try {
      const conversationResult = await db.collection('conversations').findOneAndUpdate(
        { 
          locationId,
          contactObjectId: new ObjectId(contactId),  // CHANGED: Use contactObjectId
          type: 'TYPE_PHONE'
        },
        {
          $set: {
            locationId,
            contactObjectId: new ObjectId(contactId),  // CHANGED: Use contactObjectId
            ghlContactId: contact.ghlContactId,         // ADD: Store GHL contact ID
            ghlConversationId: ghlResponse.conversationId, // Store GHL conversation ID if provided
            type: 'TYPE_PHONE',
            lastMessageAt: new Date(),
            lastMessageDate: new Date(),
            lastMessagePreview: message.substring(0, 100),
            lastMessageBody: message.substring(0, 200),
            lastMessageDirection: 'outbound',
            lastMessageType: 'TYPE_SMS',
            unreadCount: 0,
            updatedAt: new Date(),
            // Contact info (denormalized for performance)
            contactName: contact.fullName || `${contact.firstName} ${contact.lastName}`,
            contactEmail: contact.email,
            contactPhone: contact.phone
          },
          $setOnInsert: {
            createdAt: new Date(),
            dateAdded: new Date(),
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

      // MongoDB returns the document in the `value` property
      conversation = conversationResult.value;
      
      if (conversation) {
        conversationId = conversation._id;
      } else {
        // For new inserts, the ID might be in ok/value
        if (conversationResult.ok && conversationResult.lastErrorObject?.upserted) {
          conversationId = conversationResult.lastErrorObject.upserted;
        } else {
          // Fallback: fetch the conversation we just created/updated
          conversation = await db.collection('conversations').findOne({
            locationId,
            contactObjectId: new ObjectId(contactId),  // CHANGED: Use contactObjectId
            type: 'TYPE_PHONE'  // CHANGED: Use TYPE_PHONE for consistency
          });
          conversationId = conversation?._id || new ObjectId();
        }
      }
    } catch (convError) {
      // If conversation creation fails, use a new ID but log the error
      conversationId = new ObjectId();
      logger.error('CONVERSATION_CREATE_ERROR', convError, {
        requestId,
        locationId,
        contactId: contactId
      });
    }

    // Ensure we have a conversation ID
    if (!conversationId) {
      conversationId = new ObjectId();
    }

    // Publish Ably event for conversation created/updated
    await publishAblyEvent({
      locationId: locationId,
      userId: userId || req.headers['x-user-id'] as string,
      entity: conversation || {
        _id: conversationId.toString(),
        contactObjectId: contactId,
        type: 'TYPE_PHONE',
        lastMessageBody: message.substring(0, 200),
        lastMessageDirection: 'outbound'
      },
      eventType: conversation ? 'conversation.updated' : 'conversation.created'
    });

    // Add message to messages collection
    const messageRecord = {
      _id: new ObjectId(),
      conversationId: conversationId instanceof ObjectId ? conversationId : new ObjectId(conversationId),
      locationId,
      contactObjectId: new ObjectId(contactId),   // CHANGED: Use contactObjectId
      ghlContactId: contact.ghlContactId,         // ADD: Store GHL contact ID
      ghlMessageId: messageId,
      ghlConversationId: ghlResponse.conversationId, // Store GHL conversation ID
      direction: 'outbound',
      type: 1, // Numeric type for SMS
      messageType: 'TYPE_SMS',
      body: message,
      fromNumber: finalFromNumber,
      toNumber: finalToNumber,
      status: 'sent',
      templateKey: templateKey || null,
      sentBy: userId,
      sentAt: new Date(),
      dateAdded: new Date(),
      read: true,
      source: 'app',
      metadata: {
        appointmentId: appointmentId || null,
        projectId: projectId || null,
        requestId
      }
    };

    await db.collection('messages').insertOne(messageRecord);

    // Publish Ably event for new message
    await publishAblyEvent({
      locationId: locationId,
      userId: userId || req.headers['x-user-id'] as string,
      entity: messageRecord,
      eventType: 'message.created'
    });

    // Log SMS in sms_logs collection
    const smsRecord = {
      _id: new ObjectId(),
      locationId,
      contactObjectId: new ObjectId(contactId),   // CHANGED: Use contactObjectId if this collection uses it
      ghlContactId: contact.ghlContactId,         // ADD: Store GHL contact ID if needed
      appointmentId: appointmentId ? new ObjectId(appointmentId) : null,
      projectId: projectId ? new ObjectId(projectId) : null,
      templateKey: templateKey || 'custom',
      message,
      fromNumber: finalFromNumber,
      toNumber: finalToNumber,
      ghlMessageId: messageId,
      status: 'sent',
      sentAt: new Date(),
      sentBy: userId,
      requestId
    };

    await db.collection('sms_logs').insertOne(smsRecord);

    // Update appointment if provided
    if (appointmentId) {
      await db.collection('appointments').updateOne(
        { _id: new ObjectId(appointmentId) },
        {
          $push: {
            communications: {
              type: 'sms',
              templateKey,
              message,
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

      // Publish Ably event for appointment update
      await publishAblyEvent({
        locationId: locationId,
        userId: userId || req.headers['x-user-id'] as string,
        entity: {
          _id: appointmentId,
          lastCommunication: new Date()
        },
        eventType: 'appointment.updated'
      });
    }

    // Update project timeline if provided
    if (projectId) {
      await db.collection('projects').updateOne(
        { _id: new ObjectId(projectId) },
        {
          $push: {
            timeline: {
              id: new ObjectId().toString(),
              event: 'sms_sent',
              description: `SMS sent: ${templateKey || 'custom message'}`,
              timestamp: new Date().toISOString(),
              userId,
              metadata: {
                smsRecordId: smsRecord._id.toString(),
                messageId: messageRecord._id.toString(),
                templateKey,
                to: finalToNumber
              }
            }
          }
        }
      );

      // Publish Ably event for project update
      await publishAblyEvent({
        locationId: locationId,
        userId: userId || req.headers['x-user-id'] as string,
        entity: {
          _id: projectId,
          timeline: {
            event: 'sms_sent',
            timestamp: new Date().toISOString()
          }
        },
        eventType: 'project.updated'
      });
    }

    // Log success
    logger.info('SMS_SEND_SUCCESS', {
      requestId,
      messageId,
      smsRecordId: smsRecord._id.toString(),
      conversationId: conversationId.toString(),
      locationId,
      contactId: contact._id.toString(),
      templateKey: templateKey || 'custom'
    });

    return res.status(200).json({
      success: true,
      messageId,
      smsRecordId: smsRecord._id,
      conversationId: conversationId,
      message: 'SMS sent successfully'
    });

  } catch (error: any) {
    // Log error with context
    logger.error('SMS_SEND_FAILED', error, {
      requestId,
      locationId,
      contactId,
      templateKey: templateKey || 'custom',
      ghlError: error.response?.data
    });
    
    // Log failed attempt to database
    try {
      const client = await clientPromise;
      const db = client.db(getDbName());
      
      await db.collection('sms_logs').insertOne({
        locationId,
        contactId,  // Keep as is for failed logs - they might not have full contact info
        appointmentId: appointmentId ? new ObjectId(appointmentId) : null,
        projectId: projectId ? new ObjectId(projectId) : null,
        templateKey: templateKey || 'custom',
        message: customMessage || 'Failed to generate message',
        status: 'failed',
        error: error.response?.data || error.message,
        attemptedAt: new Date(),
        attemptedBy: userId,
        requestId
      });
    } catch (logError) {
      logger.error('SMS_LOG_FAILED', logError, {
        requestId,
        originalError: error.message
      });
    }
    
    return res.status(500).json({ 
      error: 'Failed to send SMS',
      details: process.env.NODE_ENV === 'development' ? error.response?.data || error.message : 'Internal server error',
      requestId
    });
  }
}
