/**
 * File: /pages/api/invoices/delete.ts
 * Purpose: Delete invoice from GHL and local database
 * Author: LPai Team
 * Last Modified: 2025-09-18
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import axios from 'axios';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const client = await clientPromise;
  const db = client.db(getDbName());

  try {
    const { invoiceId, locationId, userId } = req.body;

    if (!invoiceId || !locationId || !userId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get location for GHL API access
    const location = await db.collection('locations').findOne({ locationId });
    if (!location?.ghlOAuth?.accessToken) {
      return res.status(404).json({ error: 'Location not found or API key missing' });
    }

    // Find the payment/invoice record
    const paymentRecord = await db.collection('payments').findOne({
      _id: new ObjectId(invoiceId),
      locationId
    });

    if (!paymentRecord) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Check if invoice is already paid - don't allow deletion of paid invoices
    if (paymentRecord.status === 'completed') {
      return res.status(400).json({ error: 'Cannot delete paid invoices' });
    }

    console.log('[Delete Invoice API] Deleting invoice:', paymentRecord.ghlInvoiceId);

    // Void invoice in GHL first (pending invoices can't be deleted, only voided)
    try {
      const voidResponse = await axios.post(
        `https://services.leadconnectorhq.com/invoices/${paymentRecord.ghlInvoiceId}/void`,
        {
          altId: locationId,
          altType: 'location'
        },
        {
          headers: {
            Authorization: `Bearer ${location.ghlOAuth.accessToken}`,
            Version: '2021-07-28',
            'Content-Type': 'application/json',
            Accept: 'application/json'
          }
        }
      );
      console.log('[Delete Invoice API] Successfully voided in GHL');
    } catch (ghlError: any) {
      console.error('[Delete Invoice API] Failed to delete from GHL:', ghlError.response?.data);
      // Continue with local deletion even if GHL fails
      console.warn('[Delete Invoice API] Continuing with local deletion despite GHL error');
    }

    // Delete from local database
    await db.collection('payments').deleteOne({
      _id: new ObjectId(invoiceId),
      locationId
    });

    // Also delete from invoices collection if it exists
    await db.collection('invoices').deleteOne({
      _id: new ObjectId(invoiceId),
      locationId
    });

    // Update quote activity if there's a quote
    if (paymentRecord.quoteId) {
      await db.collection('quotes').updateOne(
        { _id: new ObjectId(paymentRecord.quoteId) },
        {
          $push: {
            activityFeed: {
              id: new ObjectId().toString(),
              action: 'invoice_deleted',
              timestamp: new Date().toISOString(),
              userId,
              metadata: {
                deletedInvoiceId: paymentRecord._id.toString(),
                invoiceNumber: paymentRecord.ghlInvoiceNumber,
                amount: paymentRecord.amount,
                type: paymentRecord.type
              }
            }
          }
        }
      );
    }

    // Update project timeline
    if (paymentRecord.projectId) {
      await db.collection('projects').updateOne(
        { _id: new ObjectId(paymentRecord.projectId) },
        {
          $push: {
            timeline: {
              id: new ObjectId().toString(),
              event: 'invoice_deleted',
              description: `${paymentRecord.type} invoice deleted (${paymentRecord.ghlInvoiceNumber})`,
              timestamp: new Date().toISOString(),
              userId,
              metadata: {
                deletedInvoiceId: paymentRecord._id.toString(),
                amount: paymentRecord.amount
              }
            }
          }
        }
      );
    }

    // Invalidate relevant caches
    const cacheKeysToInvalidate = [
      `@lpai_cache_GET_/api/payments_{"projectId":"${paymentRecord.projectId}","locationId":"${locationId}","includeDetails":"true"}`,
      `@lpai_cache_GET_/api/projects/${paymentRecord.projectId}_*`
    ];

    // Note: In production you'd want to implement proper cache invalidation
    // For now, we rely on TTL expiration
    console.log('[Delete Invoice API] Cache keys that should be invalidated:', cacheKeysToInvalidate);

    console.log('[Delete Invoice API] Invoice deleted successfully');

    return res.status(200).json({
      success: true,
      message: 'Invoice deleted successfully'
    });

  } catch (error: any) {
    console.error('[Delete Invoice API] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to delete invoice',
      details: error.message 
    });
  }
}
