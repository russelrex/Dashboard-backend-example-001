import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import axios from 'axios';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const client = await clientPromise;
  const db = client.db('lpai');

  try {
    // First, move any scheduled messages that are ready to pending
    const scheduledReady = await db.collection('sms_queue')
      .find({
        status: 'scheduled',
        scheduledFor: { $lte: new Date() }
      })
      .toArray();

    if (scheduledReady.length > 0) {
      const ids = scheduledReady.map(item => item._id);
      await db.collection('sms_queue').updateMany(
        { _id: { $in: ids } },
        { $set: { status: 'pending' } }
      );
      console.log(`Moved ${scheduledReady.length} scheduled messages to pending`);
    }

    // Then process pending messages as normal
    const pendingSMS = await db.collection('sms_queue').find({
      status: 'pending',
      $or: [
        { attempts: { $lt: 3 } },
        { attempts: { $exists: false } }
      ]
    }).limit(10).toArray();

    for (const sms of pendingSMS) {
      // Use the SMS service instead of direct GHL API call
      // This ensures proper phone number resolution and all the logic from sms/send.ts
      const smsPayload = {
        contactId: sms.contactId ? sms.contactId.toString() : sms.contactObjectId?.toString(),
        locationId: sms.locationId,
        customMessage: sms.message,
        userId: sms.userId,
        templateKey: sms.templateKey || 'automation',
        toNumber: sms.to  // Include the phone number directly
      };

      try {
        // Add proper logging to see what's happening
        console.log('📱 Processing SMS from queue:', {
          queueId: sms._id.toString(),
          hasContactId: !!sms.contactId,
          hasGhlContactId: !!sms.ghlContactId,
          toNumber: sms.to,
          messagePreview: sms.message?.substring(0, 50),
          payload: smsPayload
        });

        // Call the SMS service
        const smsResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://lpai-backend-omega.vercel.app'}/api/sms/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(smsPayload)
        });

        if (!smsResponse.ok) {
          const errorData = await smsResponse.json();
          throw new Error(errorData.error || 'SMS service failed');
        }

        const ghlResponse = await smsResponse.json();

        // Mark as sent
        await db.collection('sms_queue').updateOne(
          { _id: sms._id },
          { 
            $set: { 
              status: 'sent',
              sentAt: new Date(),
              ghlResponse,
              messageId: ghlResponse.messageId || ghlResponse.conversationId
            }
          }
        );
      } catch (error: any) {
        console.error(`Failed to send SMS ${sms._id}:`, error);
        console.error('SMS payload was:', smsPayload);
        console.error('Error details:', error.response?.data || error.message);
        await db.collection('sms_queue').updateOne(
          { _id: sms._id },
          { 
            $set: { 
              status: 'failed',
              error: error.message || 'Unknown error',
              failedAt: new Date(),
              attempts: (sms.attempts || 0) + 1
            }
          }
        );
      }
    }

    // Process Email Queue - matching your exact emails/send.ts format
    const pendingEmails = await db.collection('email_queue').find({
      status: 'pending',
      createdAt: { $gte: new Date(Date.now() - 24*60*60*1000) }
    }).limit(10).toArray();

    for (const email of pendingEmails) {
      try {
        // Build the email payload - the email service will handle all GHL lookups
        const emailPayload = {
          contactId: email.contactId ? email.contactId.toString() : email.contactObjectId?.toString(),
          locationId: email.locationId,
          subject: email.subject,
          htmlContent: email.html || email.body,
          plainTextContent: email.body,
          userId: email.userId || null
        };

        console.log('📧 Processing Email from queue:', {
          queueId: email._id.toString(),
          to: email.to,
          subject: email.subject
        });

        // Call the email service
        const emailResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://lpai-backend-omega.vercel.app'}/api/emails/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(emailPayload)
        });

        if (!emailResponse.ok) {
          const errorData = await emailResponse.json();
          throw new Error(errorData.error || 'Email service failed');
        }

        const result = await emailResponse.json();
        console.log('✅ Email sent successfully:', result);

        // Mark as sent
        await db.collection('email_queue').updateOne(
          { _id: email._id },
          { 
            $set: { 
              status: 'sent',
              sentAt: new Date(),
              ghlResponse: result,
              messageId: result.messageId || result.conversationId || result.id
            }
          }
        );
      } catch (error: any) {
        console.error(`❌ Failed to send email ${email._id}:`, error.message);
        await db.collection('email_queue').updateOne(
          { _id: email._id },
          { 
            $set: { 
              status: 'failed',
              error: error.message || 'Unknown error',
              failedAt: new Date(),
              attempts: (email.attempts || 0) + 1
            }
          }
        );
      }
    }

    return res.json({
      success: true,
      processed: {
        sms: pendingSMS.length,
        email: pendingEmails.length
      }
    });

  } catch (error) {
    console.error('Process automation messages error:', error);
    return res.status(500).json({ error: 'Processing failed' });
  }
}