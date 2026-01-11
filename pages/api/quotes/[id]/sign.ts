// pages/api/quotes/[id]/sign.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import { publishAblyEvent } from '../../../../src/utils/ably/publishEvent';
import ably from '@/lib/ably-server';
import { AutomationEventListener } from '../../../../src/services/automationEventListener';


// Helper for environment-aware logging
const isDev = process.env.NODE_ENV === 'development';
const log = (...args: any[]) => {
  if (isDev) console.log(...args);
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const { id } = req.query;
  const { locationId, signatureType, signature, signedBy, deviceInfo } = req.body;

  // Validation
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid quote ID' });
  }

  // Validate signature data before processing
  if (!signatureType || !signature || !signedBy) {
    return res.status(400).json({
      success: false,
      error: 'Missing required signature fields',
      required: ['signatureType', 'signature', 'signedBy']
    });
  }

  if (!locationId || !signatureType || !signature || !signedBy) {
    return res.status(400).json({ 
      error: 'Missing required fields: locationId, signatureType, signature, signedBy' 
    });
  }

  if (!['consultant', 'customer'].includes(signatureType)) {
    return res.status(400).json({ 
      error: 'Invalid signatureType. Must be "consultant" or "customer"' 
    });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Verify quote exists and belongs to location
    const quote = await db.collection('quotes').findOne({
      _id: new ObjectId(id),
      locationId
    });

    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    // Check if signature type is already present
    if (quote?.signatures?.[signatureType]?.signature) {
      return res.status(400).json({
        success: false,
        error: `${signatureType} signature already exists`,
        signatureType
      });
    }

    // ✅ CHECK IF ALREADY SIGNED
    const existingSignature = quote.signatures?.[signatureType];
    if (existingSignature?.signature) {
      log(`❌ [SIGN API] Quote already signed by ${signatureType}`);
      return res.status(400).json({ 
        error: `Quote already signed by ${signatureType}`,
        alreadySigned: true,
        signedAt: existingSignature.signedAt,
        signatureType: signatureType
      });
    }

    log(`✅ [SIGN API] Adding ${signatureType} signature to quote ${quote.quoteNumber}`);
    log(`✅ [SIGN API] Current signatures state:`, quote.signatures);

    // Prepare signature data
    const signatureData = {
      signature: signature, // base64 signature image
      signedAt: new Date().toISOString(),
      signedBy: signedBy,
      deviceInfo: deviceInfo || 'iPad App'
    };

    // Create activity log entry
    const activityEntry = {
      action: `${signatureType}_signed`,
      timestamp: new Date().toISOString(),
      userId: signatureType === 'consultant' ? signedBy : null,
      metadata: {
        signatureType,
        signedBy,
        deviceInfo: deviceInfo || 'iPad App'
      }
    };

    // ✅ FIX: Initialize signatures object if it's null or doesn't exist
    let updateData;
    
    if (!quote.signatures || quote.signatures === null) {
      // Initialize signatures object and add first signature
      updateData = {
        $set: {
          signatures: {
            [signatureType]: signatureData
          },
          updatedAt: new Date().toISOString()
        },
        $push: {
          activityFeed: activityEntry
        }
      };
    } else {
      // Signatures object exists, add to it
      updateData = {
        $set: {
          [`signatures.${signatureType}`]: signatureData,
          updatedAt: new Date().toISOString()
        },
        $push: {
          activityFeed: activityEntry
        }
      };
    }

    log(`✅ [SIGN API] Update data:`, JSON.stringify(updateData, null, 2));

    // Update quote with signature
    const result = await db.collection('quotes').updateOne(
      { _id: new ObjectId(id), locationId },
      updateData
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Quote not found or update failed' });
    }

    log(`✅ [SIGN API] Update result:`, result);

    // Get updated quote to check if both signatures are complete
    const updatedQuote = await db.collection('quotes').findOne({
      _id: new ObjectId(id),
      locationId
    });

    const signatures = updatedQuote?.signatures || {};
    const hasConsultantSignature = !!signatures.consultant;
    const hasCustomerSignature = !!signatures.customer;
    const fullySignedCompleted = hasConsultantSignature && hasCustomerSignature;

    // ✅ FIX: Publish Ably event AFTER getting updatedQuote and processing signatures
    await publishAblyEvent({
      locationId: updatedQuote.locationId,
      userId: req.headers['x-user-id'] as string,
      entity: updatedQuote,
      eventType: 'quote.statusChanged',
      metadata: {
        action: 'signed',
        signatureType: signatureType // 'customer' or 'consultant'
      }
    });

    // Publish real-time event
    try {
      await ably.channels.get(`user:${req.headers['x-user-id'] || 'system'}`).publish('quote-signed', {
        quoteId: id,
        signatureType: signatureType,
        fullySignedCompleted: fullySignedCompleted,
        timestamp: new Date().toISOString()
      });
      
      // Publish to location channel
      await ably.channels.get(`location:${locationId}`).publish('quote.statusChanged', {
        quoteId: id,
        status: updatedQuote.status,
        signatureType,
        isFullySigned: fullySignedCompleted,
        timestamp: new Date().toISOString()
      });
      
      // Publish to public channel
      await ably.channels.get(`user:public`).publish('quote.statusChanged', {
        quoteId: id,
        status: updatedQuote.status,
        signatureType,
        isFullySigned: fullySignedCompleted,
        timestamp: new Date().toISOString()
      });
    } catch (ablyError) {
      console.error('[Quote Sign API] Ably publish failed:', ablyError);
      // Don't fail signature process
    }

    log(`✅ [SIGN API] Signatures status:`, {
      hasConsultantSignature,
      hasCustomerSignature,
      fullySignedCompleted
    });

    // If both signatures are now complete, update status to 'signed'
    if (fullySignedCompleted && updatedQuote?.status !== 'signed') {
      await db.collection('quotes').updateOne(
        { _id: new ObjectId(id), locationId },
        {
          $set: {
            status: 'signed',
            signedAt: new Date().toISOString()
          },
          $push: {
            activityFeed: {
              action: 'quote_fully_signed',
              timestamp: new Date().toISOString(),
              userId: signatureType === 'consultant' ? signedBy : null,
              metadata: {
                bothSignaturesComplete: true
              }
            }
          }
        }
      );

      log(`🎉 [SIGN API] Quote ${quote.quoteNumber} is now fully signed!`);

      // Trigger automation for quote-signed
      try {
        const automationEventListener = new AutomationEventListener(db);
        await automationEventListener.emitQuoteSigned(updatedQuote);
        
        console.log(`[Quote Sign API] Triggered quote-signed automation for quote ${quote.quoteNumber}`);
      } catch (automationError) {
        console.error('[Quote Sign API] Failed to trigger automation:', automationError);
        // Don't fail the signature process if automation fails
      }

      // Update project status when quote is fully signed
      if (quote.projectId) {
        try {
          // Get the project to update
          const project = await db.collection('projects').findOne({
            _id: new ObjectId(quote.projectId),
            locationId
          });

          if (project) {
            // Get location for GHL OAuth token
            const location = await db.collection('locations').findOne({
              locationId: locationId
            });

            const projectUpdateData: any = {
              status: 'won',
              contractSigned: true,
              contractSignedAt: new Date(),
              monetaryValue: quote.total || 0, // Set opportunity value to quote total
              acceptedQuote: {
                quoteId: quote._id,
                quoteNumber: quote.quoteNumber,
                total: quote.total,
                depositAmount: quote.depositAmount,
                sections: quote.sections,
                signedAt: new Date(),
                customerSignature: quote.signatures?.customer,
                consultantSignature: quote.signatures?.consultant
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
                    description: `Contract signed by both consultant and customer`,
                    timestamp: new Date().toISOString(),
                    userId: signatureType === 'consultant' ? signedBy : null,
                    metadata: {
                      quoteId: id,
                      quoteNumber: quote.quoteNumber,
                      signedAt: new Date().toISOString(),
                      contractValue: quote.total || 0,
                      depositAmount: quote.depositAmount || 0,
                      quoteSections: quote.sections?.length || 0
                    }
                  }
                }
              }
            );

            // Update GHL opportunity value
            if (project.ghlOpportunityId && location?.ghlOAuth?.accessToken) {
              try {
                const ghlUpdateResponse = await fetch(`https://services.leadconnectorhq.com/opportunities/${project.ghlOpportunityId}`, {
                  method: 'PUT',
                  headers: {
                    'Authorization': `Bearer ${location.ghlOAuth.accessToken}`,
                    'Version': '2021-04-15',
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    monetaryValue: quote.total || 0,
                    status: 'won'
                  })
                });

                if (ghlUpdateResponse.ok) {
                  log(`✅ [SIGN API] Updated GHL opportunity ${project.ghlOpportunityId} with value $${quote.total}`);
                } else {
                  console.error('[SIGN API] Failed to update GHL opportunity value:', await ghlUpdateResponse.text());
                }
              } catch (ghlError) {
                console.error('[SIGN API] Failed to sync opportunity value to GHL:', ghlError);
              }
            }

            log(`✅ [SIGN API] Updated project ${quote.projectId} status to 'won' after contract signing`);
          }
        } catch (projectError) {
          console.error('[SIGN API] Failed to update project after signing:', projectError);
          // Don't fail the signature process if project update fails
        }
      }

      // ✅ TRIGGER "NO DEPOSIT" AUTOMATION FOR QUOTES WITH NO DEPOSIT
      if (quote.projectId && (quote.depositAmount === 0 || !quote.depositAmount)) {
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
                depositRequired: 0,
                status: 'signed'
              }
            },
            status: 'pending',
            createdAt: new Date(),
            attempts: 0
          });
          
          log(`✅ [SIGN API] Queued "No Deposit" automation trigger for signed quote ${quote.quoteNumber}`);
        } catch (automationError) {
          console.error('[SIGN API] Failed to queue automation:', automationError);
          // Don't fail the signature process if automation fails
        }
      }
    }

    log(`✅ [SIGN API] Successfully added ${signatureType} signature`);
    
    
    // Return success response
    return res.status(200).json({
      success: true,
      signatureType,
      fullySignedCompleted,
      quote: {
        _id: updatedQuote?._id,
        quoteNumber: updatedQuote?.quoteNumber,
        status: fullySignedCompleted ? 'signed' : updatedQuote?.status,
        signatures: updatedQuote?.signatures
      }
    });

  } catch (error: any) {
    console.error('[Quote Sign API] Signature processing failed:', {
      error: error.message,
      stack: error.stack,
      quoteId: id,
      signatureType,
      locationId
    });
    
    return res.status(500).json({
      success: false,
      error: 'Failed to process signature',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}