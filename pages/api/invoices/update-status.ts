/**
 * File: update-status.ts
 * Purpose: Update invoice status and payment method
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      invoiceId,
      status, // pending, completed, overdue, cancelled
      paymentMethod, // card, cash, check
      notes,
      checkPhotoUrl,
      cardTransactionId,
      locationId
    } = req.body;

    if (!invoiceId || !locationId) {
      return res.status(400).json({ error: 'Missing invoiceId or locationId' });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Prepare update data
    const updateData = {
      updatedAt: new Date()
    };

    if (status) updateData.status = status;
    if (paymentMethod) updateData.paymentMethod = paymentMethod;
    if (notes) updateData.notes = notes;
    if (checkPhotoUrl) updateData.checkPhotoUrl = checkPhotoUrl;
    if (cardTransactionId) updateData.cardTransactionId = cardTransactionId;

    // If marking as completed, set completion timestamp
    if (status === 'completed') {
      updateData.completedAt = new Date();
    }

    // Update in payments collection (main record)
    const result = await db.collection('payments').updateOne(
      { 
        _id: new ObjectId(invoiceId),
        locationId: locationId 
      },
      { $set: updateData }
    );

    // Also update in invoices collection for consistency
    await db.collection('invoices').updateOne(
      { 
        _id: new ObjectId(invoiceId),
        locationId: locationId 
      },
      { 
        $set: {
          status: updateData.status,
          updatedAt: updateData.updatedAt
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Invoice status updated successfully',
      invoiceId,
      updatedFields: Object.keys(updateData)
    });

  } catch (error) {
    console.error('[Invoice Update Status API] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
