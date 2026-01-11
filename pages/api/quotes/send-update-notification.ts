// pages/api/quotes/send-update-notification.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify JWT
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    jwt.verify(token, process.env.JWT_SECRET!);

    const {
      quoteId,
      locationId,
      userId,
      type, // 'email' or 'sms'
      to,
      changesSummary,
      previousTotal,
      newTotal,
      customMessage,
    } = req.body;

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Get quote with enriched data
    const quote = await db.collection('quotes').findOne({
      _id: new ObjectId(quoteId)
    });

    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    // Get contact and location info
    const [contact, location] = await Promise.all([
      db.collection('contacts').findOne({ _id: new ObjectId(quote.contactId) }),
      db.collection('locations').findOne({ locationId })
    ]);

    const webLink = `${process.env.NEXT_PUBLIC_APP_URL}/quote/${quote.webLinkToken}`;

    if (type === 'email') {
      // Get email template
      const template = await db.collection('email_templates').findOne({
        _id: 'quote_updated_notification'
      });

      // Prepare variables
      const variables = {
        customerName: contact?.firstName || 'Customer',
        quoteNumber: quote.quoteNumber,
        quoteTitle: quote.title,
        totalAmount: newTotal?.toLocaleString() || quote.total?.toLocaleString(),
        previousAmount: previousTotal?.toLocaleString(),
        changesSummary: customMessage || changesSummary,
        webLink,
        companyName: location?.name || 'Your Company',
        senderName: `${location?.firstName} ${location?.lastName}`.trim() || 'Your Team'
      };

      // Replace variables in template
      let htmlContent = template?.htmlTemplate || '';
      Object.entries(variables).forEach(([key, value]) => {
        htmlContent = htmlContent.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
      });

      // Send email
      await resend.emails.send({
        from: `${variables.senderName} <${process.env.ADMIN_EMAIL}>`,
        to: [to],
        subject: `Your Quote Has Been Updated - ${quote.quoteNumber}`,
        html: htmlContent,
      });

    } else if (type === 'sms') {
      // Use GHL to send SMS (same as your other SMS endpoints)
      const message = customMessage || 
        `Hi ${contact?.firstName}, your quote ${quote.quoteNumber} has been updated. ` +
        `New total: $${newTotal?.toLocaleString() || quote.total?.toLocaleString()}. ` +
        `View changes: ${webLink}`;

      // Send via GHL API
      const ghlLocation = await db.collection('locations').findOne({ locationId });
      
      if (!ghlLocation?.ghlApiKey) {
        throw new Error('GHL API key not configured for location');
      }

      // Use GHL Conversations API to send SMS
      const ghlResponse = await fetch(
        `https://services.leadconnectorhq.com/conversations/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ghlLocation.ghlApiKey}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28'
          },
          body: JSON.stringify({
            type: 'SMS',
            contactId: contact?.ghlContactId,
            message: message,
            userId: userId
          })
        }
      );

      if (!ghlResponse.ok) {
        throw new Error('Failed to send SMS via GHL');
      }
    }

    // Log notification in activity feed
    await db.collection('quotes').updateOne(
      { _id: new ObjectId(quoteId) },
      {
        $push: {
          activityFeed: {
            action: 'update_notification_sent',
            timestamp: new Date(),
            userId,
            metadata: {
              type,
              sentTo: to,
              changesSummary,
              previousTotal,
              newTotal
            }
          }
        }
      }
    );

    res.status(200).json({ success: true });

  } catch (error) {
    console.error('[Update Notification] Error:', error);
    res.status(500).json({ error: 'Failed to send notification' });
  }
}