/**
 * File: list.ts  
 * Purpose: Get invoices for a project
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { projectId, locationId, status } = req.query;

  if (!projectId || !locationId) {
    return res.status(400).json({ error: 'Missing projectId or locationId' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Build query
    const query = {
      projectId: new ObjectId(projectId as string),
      locationId: locationId as string,
      status: { $ne: 'failed' } // Always exclude failed
    };
    
    // Add status filter if provided
    if (status && status !== 'all') {
      query.status = status as string; // pending, completed, overdue
    }

    // Get invoices from unified collection
    const invoices = await db.collection('payments').find(query)
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      count: invoices.length,
      invoices: invoices.map(invoice => ({
        _id: invoice._id,
        ghlInvoiceId: invoice.ghlInvoiceId,
        invoiceNumber: invoice.ghlInvoiceNumber || invoice.invoiceNumber,
        amount: invoice.amount,
        type: invoice.type, // deposit, progress, full
        status: invoice.status, // pending, completed, overdue
        paymentMethod: invoice.paymentMethod, // null if unpaid
        paymentUrl: invoice.ghlInvoiceUrl,
        dueDate: invoice.dueDate,
        createdAt: invoice.createdAt,
        completedAt: invoice.completedAt,
        emailSentCount: invoice.emailSentCount || 0,
        lastEmailSentAt: invoice.lastEmailSentAt,
        notes: invoice.notes,
        // Computed fields
        isOverdue: invoice.status === 'pending' && invoice.dueDate && new Date(invoice.dueDate) < new Date(),
        daysPastDue: invoice.dueDate ? Math.max(0, Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / (24 * 60 * 60 * 1000))) : 0
      }))
    });

  } catch (error) {
    console.error('[Invoice List API] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
