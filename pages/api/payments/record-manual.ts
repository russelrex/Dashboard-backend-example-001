// pages/api/payments/record-manual.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import axios from 'axios';
import { publishAblyEvent } from '../../../src/utils/ably/publishEvent';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const client = await clientPromise;
  const db = client.db(getDbName());

  try {
    const {
      invoiceId,
      locationId,
      amount,
      mode, // 'cash' or 'cheque'
      checkNumber,
      notes,
      userId
    } = req.body;

    // Get location for API key
    const location = await db.collection('locations').findOne({ locationId });
    if (!location?.ghlOAuth?.accessToken) {
      return res.status(404).json({ error: 'Location not found or API key missing' });
    }

    // Get user's GHL ID
    const user = await db.collection('users').findOne({ 
      _id: new ObjectId(userId),
      locationId 
    });

    if (!user?.ghlUserId) {
      return res.status(400).json({ error: 'User missing GHL ID' });
    }

    // Get the payment record to get project and quote info
    let paymentRecord = await db.collection('payments').findOne({
      ghlInvoiceId: invoiceId,
      locationId
    });

    // If payment record not found, check if it's an invoice-only record
    if (!paymentRecord) {
      // Try to find by invoice details
      const invoice = await db.collection('invoices').findOne({
        $or: [
          { _id: invoiceId },
          { ghlInvoiceId: invoiceId }
        ]
      });
      
      if (!invoice) {
        return res.status(404).json({ error: 'Invoice not found' });
      }
      
      // Create payment record from invoice
      const newPaymentRecord = {
        _id: new ObjectId(),
        ghlInvoiceId: invoiceId,
        locationId,
        projectId: invoice.projectId,
        quoteId: invoice.quoteId,
        contactId: invoice.contactId,
        amount: amount,
        type: 'deposit',
        status: 'pending',
        isDeposit: true, // Add deposit flag for new payment records
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      await db.collection('payments').insertOne(newPaymentRecord);
      paymentRecord = newPaymentRecord;
    }

    // ✅ CHECK PAYMENT STATUS
    if (paymentRecord.status === 'completed') {
      // Check if project has transitioned
      const project = await db.collection('projects').findOne({
        _id: new ObjectId(paymentRecord.projectId)
      });
      
      return res.status(200).json({
        success: true,
        alreadyPaid: true,
        message: 'Payment already recorded',
        paymentDetails: {
          paidAt: paymentRecord.completedAt,
          amount: paymentRecord.amount,
          method: paymentRecord.paymentMethod || mode, // Use the current mode if no method set
          projectStatus: project?.status,
          pipelineId: project?.pipelineId,
          projectId: paymentRecord.projectId
        }
      });
    }

    // ✅ HANDLE METHOD CONVERSION
    // If this payment was originally created for card payment but now being recorded manually
    if (paymentRecord.method === 'card' && (mode === 'cash' || mode === 'cheque')) {
      console.log(`[Record Payment API] Converting card payment to ${mode} payment for invoice:`, invoiceId);
      
      // Update the payment method in our local record first
      await db.collection('payments').updateOne(
        { ghlInvoiceId: invoiceId },
        { 
          $set: { 
            method: mode,
            updatedAt: new Date(),
            notes: `Payment method changed from card to ${mode} for manual recording`
          } 
        }
      );
      
      // Re-fetch the updated record
      paymentRecord = await db.collection('payments').findOne({
        ghlInvoiceId: invoiceId,
        locationId
      });
    }

    // ✅ CHECK GHL INVOICE STATUS FIRST
    try {
      const invoiceCheckResponse = await axios.get(
        `https://services.leadconnectorhq.com/invoices/${invoiceId}`,
        {
          headers: {
            Authorization: `Bearer ${location.ghlOAuth.accessToken}`,
            Version: '2021-07-28',
            Accept: 'application/json'
          }
        }
      );

      if (invoiceCheckResponse.data?.status === 'paid') {
        console.log('[Record Payment API] Invoice already paid in GHL, updating local records');
        
        // Update local payment record to match GHL
        const updateData = {
          status: 'completed',
          completedAt: new Date(),
          paymentMethod: mode,
          ghlPaymentId: invoiceCheckResponse.data.id,
          updatedAt: new Date()
        };

        await db.collection('payments').updateOne(
          { ghlInvoiceId: invoiceId },
          { $set: updateData }
        );

        // Also update invoices collection for consistency
        await db.collection('invoices').updateOne(
          { ghlInvoiceId: invoiceId },
          { 
            $set: {
              status: 'completed',
              paymentMethod: mode,
              updatedAt: updateData.updatedAt
            }
          }
        );

        console.log('[Record Manual] Payment updated in both collections for already paid invoice:', invoiceId);
        
        return res.status(200).json({
          success: true,
          alreadyPaid: true,
          message: 'Payment already recorded in system',
          paymentDetails: {
            paidAt: new Date(),
            amount: paymentRecord.amount,
            method: mode,
            projectStatus: 'active',
            projectId: paymentRecord.projectId
          }
        });
      }
    } catch (checkError) {
      console.log('[Record Payment API] Could not check GHL invoice status:', checkError.response?.data);
      // Continue anyway - don't fail if we can't check
    }

    // Record payment in GHL
    const paymentPayload = {
      altId: locationId,
      altType: 'location',
      mode: mode,
      card: mode === 'cash' ? { brand: 'string', last4: 'string' } : undefined,
      cheque: mode === 'cheque' ? {
        number: checkNumber || `CHK-${Date.now()}`,
      } : undefined,
      amount: Math.round(amount * 100) / 100,
      meta: {},
      paymentScheduleIds: []
    };

    console.log('[Record Payment API] Recording payment for invoice:', invoiceId);
    console.log('[Record Payment API] Payload:', JSON.stringify(paymentPayload, null, 2));

    const response = await axios.post(
      `https://services.leadconnectorhq.com/invoices/${invoiceId}/record-payment`,
      paymentPayload,
      {
        headers: {
          Authorization: `Bearer ${location.ghlOAuth.accessToken}`,
          Version: '2021-07-28',
          'Content-Type': 'application/json',
          Accept: 'application/json'
        }
      }
    );

    console.log('[Record Payment API] Payment recorded successfully');

    // Mark invoice/payment as completed
    const updateData = {
      status: 'completed',
      paymentMethod: mode,
      completedAt: new Date(),
      updatedAt: new Date(),
      ghlPaymentId: response.data._id,
      isDeposit: paymentRecord.type === 'deposit', // Add deposit flag
      notes: `Manual ${mode} payment recorded`
    };
    
    // Add check-specific fields
    if (mode === 'cheque') {
      updateData.checkNumber = checkNumber;
    }
    
    // Add photo URL if check payment
    if (mode === 'check' && checkPhotoUrl) {
      updateData.checkPhotoUrl = checkPhotoUrl;
    }

    const updateResult = await db.collection('payments').updateOne(
      { ghlInvoiceId: invoiceId },
      { $set: updateData }
    );
    
    // Also update invoices collection for consistency
    await db.collection('invoices').updateOne(
      { ghlInvoiceId: invoiceId },
      { 
        $set: {
          status: 'completed',
          updatedAt: updateData.updatedAt
        }
      }
    );

    // Now update the quote if there's a quoteId
    if (paymentRecord.quoteId) {
      const quote = await db.collection('quotes').findOne({
        _id: new ObjectId(paymentRecord.quoteId)
      });
      
      if (quote) {
        const isDeposit = paymentRecord.type === 'deposit';
        const currentPaid = quote.paymentSummary?.totalPaid || 0;
        const newTotalPaid = currentPaid + paymentRecord.amount;
        const balance = quote.total - newTotalPaid;
        
        // Initialize payment summary if it doesn't exist
        const paymentSummary = quote.paymentSummary || {
          totalRequired: quote.total,
          depositRequired: quote.depositAmount || 0,
          depositPaid: 0,
          totalPaid: 0,
          balance: quote.total,
          paymentIds: []
        };
        
        const updateData: any = {
          paymentSummary: {
            ...paymentSummary,
            totalPaid: newTotalPaid,
            balance: balance,
            lastPaymentAt: new Date()
          },
          updatedAt: new Date()
        };
        
        // If this is a deposit payment
        if (isDeposit) {
          updateData.paymentSummary.depositPaid = paymentRecord.amount;
          updateData.paymentSummary.depositPaidAt = new Date();
          updateData.status = 'deposit_paid';
        }
        
        // If fully paid
        if (balance <= 0) {
          updateData.status = 'paid';
          updateData.paidAt = new Date();
        }
        
        // Add payment ID to the array if not already there
        if (!updateData.paymentSummary.paymentIds) {
          updateData.paymentSummary.paymentIds = [];
        }
        if (!updateData.paymentSummary.paymentIds.includes(paymentRecord._id.toString())) {
          updateData.paymentSummary.paymentIds.push(paymentRecord._id);
        }
        
        await db.collection('quotes').updateOne(
          { _id: new ObjectId(paymentRecord.quoteId) },
          {
            $set: updateData,
            $push: {
              activityFeed: {
                id: new ObjectId().toString(),
                action: isDeposit ? 'deposit_payment_completed' : 'payment_completed',
                timestamp: new Date().toISOString(),
                userId,
                metadata: {
                  paymentId: paymentRecord._id.toString(),
                  amount: paymentRecord.amount,
                  type: paymentRecord.type,
                  method: mode,
                  checkNumber: mode === 'cheque' ? checkNumber : undefined,
                  balance: balance
                }
              }
            }
          }
        );
        
        console.log(`[Record Payment API] Updated quote ${paymentRecord.quoteId} with manual payment completion`);
      }
    }

    // Update the project if there's a projectId
    if (paymentRecord.projectId) {
      const isDeposit = paymentRecord.type === 'deposit';
      
      // Get current project to check payment status
      const project = await db.collection('projects').findOne({
        _id: new ObjectId(paymentRecord.projectId)
      });
      
      if (project) {
        const projectUpdateData: any = {
          updatedAt: new Date()
        };
        
        // If this is a deposit payment
        if (isDeposit) {
          projectUpdateData.depositPaid = true;
          projectUpdateData.depositPaidAt = new Date();
          projectUpdateData.depositAmount = paymentRecord.amount;
          
          // Update status if needed
          if (project.status === 'won') {
            projectUpdateData.status = 'in_progress';
          }
        }
        
        await db.collection('projects').updateOne(
          { _id: new ObjectId(paymentRecord.projectId), locationId: paymentRecord.locationId },
          {
            $set: projectUpdateData,
            $push: {
              timeline: {
                id: new ObjectId().toString(),
                event: isDeposit ? 'deposit_payment_completed' : 'payment_completed',
                description: `${paymentRecord.type} payment of $${paymentRecord.amount} completed (${mode})`,
                timestamp: new Date().toISOString(),
                userId,
                metadata: {
                  paymentId: paymentRecord._id.toString(),
                  amount: paymentRecord.amount,
                  type: paymentRecord.type,
                  method: mode,
                  checkNumber: mode === 'cheque' ? checkNumber : undefined
                }
              }
            }
          }
        );
        
        console.log(`[Record Payment API] Updated project ${paymentRecord.projectId} with manual payment completion`);
      }
    }

    // ✅ TRIGGER AUTOMATION FOR DEPOSIT PAYMENTS
    if (paymentRecord.type === 'deposit' && paymentRecord.projectId) {
      try {
        // Get full project and contact data for automation context
        const project = await db.collection('projects').findOne({ 
          _id: new ObjectId(paymentRecord.projectId) 
        });
        const contact = await db.collection('contacts').findOne({ 
          _id: new ObjectId(paymentRecord.contactId) 
        });

        await db.collection('automation_queue').insertOne({
          trigger: {
            type: 'payment-received',
            entityType: 'project',  // ✅ Changed from 'payment' to 'project'
            locationId: paymentRecord.locationId,
            data: {
              paymentId: paymentRecord._id.toString(),
              projectId: paymentRecord.projectId,
              quoteId: paymentRecord.quoteId,
              contactId: paymentRecord.contactId,
              amount: paymentRecord.amount,
              paymentType: 'deposit',
              payment: {
                type: 'deposit',
                amount: paymentRecord.amount,
                method: mode
              },
              project,
              contact,
              locationId: paymentRecord.locationId
            }
          },
          status: 'pending',
          createdAt: new Date(),
          attempts: 0
        });
        
        console.log(`[Record Payment API] Queued automation trigger for deposit payment on project ${paymentRecord.projectId}`);
      } catch (automationError) {
        console.error('[Record Payment API] Failed to queue automation:', automationError);
        // Don't fail the payment recording if automation fails
      }
    }

    // Publish real-time event for payment completion
    try {
      await publishAblyEvent({
        locationId,
        userId,
        entity: {
          paymentId: paymentRecord._id,
          projectId: paymentRecord.projectId,
          quoteId: paymentRecord.quoteId,
          amount: paymentRecord.amount,
          type: paymentRecord.type,
          status: 'completed'
        },
        eventType: 'payment.completed'
      });
    } catch (ablyError) {
      console.error('[Record Payment API] Ably publish failed:', ablyError);
    }

    return res.status(200).json({
      success: true,
      message: 'Payment recorded successfully',
      paymentId: response.data._id
    });

  } catch (error: any) {
    console.error('[Record Payment API] Error:', error.response?.data || error);
    return res.status(500).json({ 
      error: 'Failed to record payment',
      details: error.response?.data 
    });
  }
}