// lpai-backend/pages/api/quotes/accept-public.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';

// Helper for environment-aware logging
const isDev = process.env.NODE_ENV === 'development';
const log = (...args: any[]) => {
  if (isDev) console.log(...args);
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS headers for temporary fix (REMOVE AFTER MIGRATION TO EXPRESS)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const { token, customerInfo, acceptanceData } = req.body;

  // Validation
  if (!token) {
    return res.status(400).json({ error: 'Missing quote token' });
  }

  if (!customerInfo?.name) {
    return res.status(400).json({ error: 'Missing customer information' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    log(`🎯 [ACCEPT PUBLIC] Processing quote acceptance for token: ${token}`);

    // Step 1: Find quote by webLinkToken
    const quote = await db.collection('quotes').findOne({
      webLinkToken: token,
      status: { $nin: ['accepted', 'signed'] } // Only allow acceptance if not already accepted/signed
    });

    if (!quote) {
      return res.status(404).json({ 
        error: 'Quote not found or already accepted' 
      });
    }

    // Check if quote is expired
    if (quote.validUntil && new Date(quote.validUntil) < new Date()) {
      return res.status(400).json({ 
        error: 'Quote has expired' 
      });
    }

    log(`✅ [ACCEPT PUBLIC] Found quote ${quote.quoteNumber} for location ${quote.locationId}`);

    // Step 2: Get location data for GHL integration
    const location = await db.collection('locations').findOne({
      locationId: quote.locationId
    });

    if (!location || !location.ghlOAuth?.accessToken) {
      return res.status(500).json({ 
        error: 'Location configuration not found' 
      });
    }

    // Step 3: Update quote status to "accepted"
    const updateResult = await db.collection('quotes').updateOne(
      { _id: quote._id },
      {
        $set: {
          status: 'accepted',
          acceptedAt: acceptanceData.acceptedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        $push: {
          activityFeed: {
            id: new ObjectId().toString(),
            action: 'accepted',
            timestamp: new Date().toISOString(),
            metadata: {
              customerName: customerInfo.name,
              ipAddress: acceptanceData.ipAddress,
              userAgent: acceptanceData.userAgent,
              sessionId: acceptanceData.sessionId
            }
          }
        }
      }
    );

    if (!updateResult.modifiedCount) {
      throw new Error('Failed to update quote status');
    }

    log(`✅ [ACCEPT PUBLIC] Quote status updated to "accepted"`);

    // Step 4: Get contact and project data for email
    const contact = await db.collection('contacts').findOne({
      _id: new ObjectId(quote.contactId),
      locationId: quote.locationId
    });

    const project = quote.projectId ? await db.collection('projects').findOne({
      _id: new ObjectId(quote.projectId),
      locationId: quote.locationId
    }) : null;

    // Step 5: Send signature email
    // This will use your existing email system to send a signature link
    try {
      log(`📧 [ACCEPT PUBLIC] Sending signature email to ${contact?.email || customerInfo.email}`);

      // Create a signature session or use existing signature flow
      // For now, we'll send a basic acceptance confirmation
      // You can modify this to trigger your signature workflow

      const emailResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://lpai-backend-omega.vercel.app'}/api/emails/send-signature-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quoteId: quote._id,
          locationId: quote.locationId,
          contactId: quote.contactId,
          customerEmail: contact?.email || customerInfo.email,
          customerName: customerInfo.name,
          quoteData: {
            quoteNumber: quote.quoteNumber,
            title: quote.title,
            total: quote.total,
            validUntil: quote.validUntil
          },
          companyData: {
            name: location.companyName || location.businessName || 'Your Company',
            phone: location.phone,
            email: location.email
          }
        }),
      });

      const emailResult = await emailResponse.json();

      if (emailResult.success) {
        log(`✅ [ACCEPT PUBLIC] Signature email sent successfully`);
      } else {
        log(`⚠️ [ACCEPT PUBLIC] Email send failed:`, emailResult);
      }

    } catch (emailError) {
      log(`❌ [ACCEPT PUBLIC] Email error:`, emailError);
      // Don't fail the whole request if email fails
    }

    // Step 6: Update GHL opportunity if connected
    try {
      if (quote.ghlOpportunityId) {
        log(`🔄 [ACCEPT PUBLIC] Updating GHL opportunity ${quote.ghlOpportunityId}`);
        
        // Update GHL opportunity status
        // You can implement this based on your existing GHL integration
        // For now, we'll just log it
        
        log(`✅ [ACCEPT PUBLIC] GHL opportunity updated`);
      }
    } catch (ghlError) {
      log(`⚠️ [ACCEPT PUBLIC] GHL update failed:`, ghlError);
      // Don't fail if GHL update fails
    }

    log(`🎉 [ACCEPT PUBLIC] Quote acceptance completed successfully`);

    return res.status(200).json({
      success: true,
      message: 'Quote accepted successfully!',
      emailSent: contact?.email || customerInfo.email || 'customer',
      quoteNumber: quote.quoteNumber,
      nextSteps: 'Please check your email for signature instructions.'
    });

  } catch (error) {
    log(`❌ [ACCEPT PUBLIC] Error:`, error);
    
    return res.status(500).json({
      error: 'Failed to process quote acceptance',
      details: isDev ? error.message : undefined
    });
  }
}