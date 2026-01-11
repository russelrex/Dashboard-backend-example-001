// lpai-backend/pages/api/quotes/[id]/sign-public.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import { publishAblyEvent } from '../../../../src/utils/ably/publishEvent';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS headers for temporary fix (REMOVE AFTER MIGRATION TO EXPRESS)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST', 'OPTIONS']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const { id: quoteId } = req.query;
    const { token, signature, signedBy, deviceInfo } = req.body;

    if (!quoteId || !token || !signature || !signedBy) {
      return res.status(400).json({ 
        error: 'Missing required fields: quoteId, token, signature, signedBy' 
      });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Find the quote by public token and ID
    // Find the quote by web link token and ID
    const quote = await db.collection('quotes').findOne({ 
    webLinkToken: token 
    });

// Then verify it matches the ID in the URL
if (!quote) {
  return res.status(404).json({ error: 'Quote not found or invalid token' });
}

if (quote._id.toString() !== quoteId) {
  return res.status(400).json({ error: 'Quote ID mismatch' });
}

    // Check if quote is already signed
    if (quote.status === 'signed') {
      return res.status(400).json({ 
        error: 'Quote has already been signed',
        currentStatus: quote.status 
      });
    }

    // Check if quote is expired
    if (quote.validUntil && new Date(quote.validUntil) < new Date()) {
      return res.status(400).json({ error: 'Quote has expired' });
    }

    // Prepare signature data
    const signatureData = {
      signature: signature,
      signedBy: signedBy,
      signedAt: new Date(),
      deviceInfo: {
        userAgent: deviceInfo?.userAgent || 'Unknown',
        deviceType: deviceInfo?.deviceType || 'Unknown',
        ipAddress: deviceInfo?.ipAddress || 'Unknown',
        sessionId: deviceInfo?.sessionId || 'Unknown',
      }
    };

    // Update quote with signature
    const updateResult = await db.collection('quotes').updateOne(
      { _id: new ObjectId(quoteId as string) },
      {
        $set: {
          status: 'signed',
          signedAt: new Date(),
          signatures: {
            customer: signatureData
          },
          updatedAt: new Date()
        },
        $push: {
          timeline: {
            id: new ObjectId().toString(),
            event: 'quote_signed',
            description: `Quote signed by ${signedBy} via public link`,
            timestamp: new Date(),
            metadata: {
              signedBy: signedBy,
              signatureMethod: 'public_web',
              ipAddress: deviceInfo?.ipAddress,
              userAgent: deviceInfo?.userAgent,
              sessionId: deviceInfo?.sessionId
            }
          }
        }
      }
    );

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ error: 'Quote not found during update' });
    }

    // Fetch the updated quote for the Ably event
    const updatedQuote = await db.collection('quotes').findOne({ _id: new ObjectId(quoteId as string) });
    
    // Publish Ably event for quote signed via public link
    await publishAblyEvent({
      locationId: quote.locationId,
      userId: 'public', // Since this is a public signature, we don't have a user ID
      entity: updatedQuote,
      eventType: 'quote.statusChanged',
      metadata: {
        action: 'signed',
        signatureType: 'customer',
        signatureMethod: 'public_web',
        signedBy: signedBy
      }
    });

    // ✅ GENERATE PDF FIRST
    let pdfUrl = null;
    try {
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://lpai-backend-omega.vercel.app';
      const pdfResponse = await fetch(`${API_BASE_URL}/api/quotes/${quoteId}/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          locationId: quote.locationId,
          includeSignatures: true,
          regenerate: true 
        })
      });
      
      if (pdfResponse.ok) {
        const pdfResult = await pdfResponse.json();
        pdfUrl = pdfResult.pdfUrl || pdfResult.pdf?.fileId;
        console.log(`✅ [Contract PDF] Generated PDF: ${pdfUrl}`);
      } else {
        console.error('[Contract PDF] PDF generation failed:', await pdfResponse.text());
      }
    } catch (pdfError) {
      console.error('[Contract PDF] PDF generation error:', pdfError);
    }

    // Send confirmation email to customer using the existing send-contract API
    try {
      const customerEmail = quote.contact?.email || quote.contactEmail;
      if (customerEmail) {
        const API_BASE_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
        
        // Get location data for company information
        const location = await db.collection('locations').findOne({ 
          locationId: quote.locationId 
        });
        
        if (location) {
          // Generate PDF first if needed
          let pdfGenerated = false;
          try {
            const pdfResponse = await fetch(`${API_BASE_URL}/api/quotes/${quote._id}/pdf`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                locationId: quote.locationId,
                regenerate: true 
              })
            });
            
            if (pdfResponse.ok) {
              const pdfResult = await pdfResponse.json();
              pdfGenerated = pdfResult.success;
              console.log('[Contract Signed] PDF generation result:', pdfGenerated);
            }
          } catch (pdfError) {
            console.error('[Contract Signed] PDF generation error:', pdfError);
          }
          
          // Send contract signed email with PDF attachment
          const contractEmailResponse = await fetch(`${API_BASE_URL}/api/emails/send-contract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              quoteId: quote._id,
              locationId: quote.locationId,
              contactId: quote.contactId,
              templateName: 'Contract Signed',
              customSubject: `Contract Signed - ${quote.title}`,
              regeneratePDF: pdfGenerated ? false : true, // Use existing PDF if just generated
              quoteData: quote,
              companyData: {
                name: location.name,
                phone: location.phone,
                email: location.email,
                address: location.address
              }
            }),
          });

          if (contractEmailResponse.ok) {
            const emailResult = await contractEmailResponse.json();
            console.log('[Contract Signed] Customer email sent successfully:', {
              emailId: emailResult.emailId,
              pdfAttached: !!emailResult.pdfUrl,
              templateUsed: emailResult.templateUsed
            });
          } else {
            const errorText = await contractEmailResponse.text();
            console.error('[Contract Signed] Customer email failed:', errorText);
          }
        }
      }
    } catch (emailError) {
      console.error('[Contract Signed] Email sending error:', emailError);
      // Don't fail the signature if email sending fails
    }

    // Update project status if linked
    if (quote.projectId) {
      try {
        const projectUpdateData = {
          status: 'won',
          contractSigned: true,
          contractSignedAt: new Date(),
          monetaryValue: quote.total || 0,
          acceptedQuote: {
            quoteId: quote._id,
            quoteNumber: quote.quoteNumber,
            total: quote.total,
            depositAmount: quote.depositAmount,
            sections: quote.sections,
            signedAt: new Date(),
            customerSignature: signatureData,
            consultantSignature: null // Public signing is customer-only
          },
          updatedAt: new Date()
        };

        await db.collection('projects').updateOne(
          { _id: new ObjectId(quote.projectId) },
          {
            $set: projectUpdateData,
            $push: {
              timeline: {
                id: new ObjectId().toString(),
                event: 'contract_signed',
                description: `Contract signed by ${signedBy} via public link`,
                timestamp: new Date(),
                metadata: {
                  quoteId: quote._id,
                  signedBy: signedBy,
                  signatureMethod: 'public_web',
                  ipAddress: deviceInfo?.ipAddress,
                  userAgent: deviceInfo?.userAgent,
                  sessionId: deviceInfo?.sessionId
                }
              }
            }
          }
        );

        console.log(`✅ [SIGN PUBLIC] Updated project ${quote.projectId} with acceptedQuote data`);
      } catch (projectError) {
        console.error('Project update error:', projectError);
        // Don't fail the signature if project update fails
      }
    }

    // ✅ TRIGGER AUTOMATION FOR CONTRACT SIGNED
    try {
      await db.collection('automation_queue').insertOne({
        trigger: {
          type: 'quote-signed',
          entityType: 'quote',
          locationId: quote.locationId,
          data: {
            quoteId: quote._id.toString(),
            projectId: quote.projectId,
            contactId: quote.contactId,
            quoteNumber: quote.quoteNumber,
            signedBy: signedBy,
            signatureMethod: 'public_web',
            contractValue: quote.total || 0,
            depositAmount: quote.depositAmount || 0
          }
        },
        status: 'pending',
        createdAt: new Date(),
        attempts: 0
      });
      console.log(`✅ [Contract Signed] Queued automation for quote ${quote.quoteNumber}`);
    } catch (automationError) {
      console.error('[Contract Signed] Failed to queue automation:', automationError);
    }

    // ✅ SEND ABLY REAL-TIME UPDATES
    try {
      const ably = await import('ably').then(m => new m.Realtime(process.env.ABLY_API_KEY || ''));
      
      // Notify location team
      await ably.channels.get(`location:${quote.locationId}`).publish('contract.signed', {
        quoteId: quote._id.toString(),
        quoteNumber: quote.quoteNumber,
        projectId: quote.projectId,
        customerName: signedBy,
        contractValue: quote.total,
        signedAt: new Date().toISOString()
      });

      // Notify assigned user if exists  
      if (quote.assignedTo) {
        await ably.channels.get(`user:${quote.assignedTo}`).publish('contract.signed', {
          quoteId: quote._id.toString(),
          quoteNumber: quote.quoteNumber,
          customerName: signedBy,
          contractValue: quote.total,
          message: `${signedBy} signed contract ${quote.quoteNumber}!`
        });
      }

      console.log(`✅ [Contract Signed] Sent Ably notifications for quote ${quote.quoteNumber}`);
    } catch (ablyError) {
      console.error('[Contract Signed] Failed to send Ably notifications:', ablyError);
    }

    // ✅ SEND RESEND EMAIL NOTIFICATIONS TO TEAM
    try {
      const notifications = [];
      
      // Get location data for team email
      const location = await db.collection('locations').findOne({ locationId: quote.locationId });
      
      // 1. Email to assigned user (if exists)
      if (quote.assignedTo) {
        const assignedUser = await db.collection('users').findOne({ _id: new ObjectId(quote.assignedTo) });
        if (assignedUser?.email) {
          notifications.push({
            to: assignedUser.email,
            recipientName: assignedUser.name || assignedUser.firstName,
            notificationType: 'assigned_user'
          });
        }
      }
      
      // 2. Email to location team email
      if (location?.email) {
        notifications.push({
          to: location.email,
          recipientName: location.name || 'Team',
          notificationType: 'location_team'
        });
      }
      
      // 3. Send notifications using our new Resend endpoint
      const API_BASE_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
      
      for (const notification of notifications) {
        try {
          const emailResponse = await fetch(`${API_BASE_URL}/api/emails/contract-signed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: notification.to,
              recipientName: notification.recipientName,
              quoteNumber: quote.quoteNumber,
              projectTitle: quote.title,
              customerName: signedBy,
              contractValue: `$${quote.total?.toLocaleString() || '0'}`,
              signedAt: new Date().toLocaleDateString(),
              notificationType: notification.notificationType
            }),
          });
          
          if (emailResponse.ok) {
            console.log(`✅ [Contract Signed] Sent ${notification.notificationType} notification via Resend to: ${notification.to}`);
          } else {
            console.error(`[Contract Signed] Failed to send ${notification.notificationType} notification:`, await emailResponse.text());
          }
        } catch (emailError) {
          console.error(`[Contract Signed] Email error for ${notification.notificationType}:`, emailError);
        }
      }
    } catch (notificationError) {
      console.error('[Contract Signed] Team notification error:', notificationError);
    }

    return res.status(200).json({
      success: true,
      message: 'Quote signed successfully',
      signedAt: signatureData.signedAt,
      signedBy: signedBy,
      quoteNumber: quote.quoteNumber
    });

  } catch (error) {
    console.error('Error signing quote:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}