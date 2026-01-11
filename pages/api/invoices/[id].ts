import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import { triggerInvoiceAutomation } from '@/utils/automations/triggerHelper';
import { publishAblyEvent } from '../../../src/utils/ably/publishEvent';
import { 
  sendSuccess, 
  sendError, 
  sendValidationError,
  sendServerError,
  sendMethodNotAllowed 
} from '../../../src/utils/response';
import cors from '@/lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const client = await clientPromise;
  const db = client.db(getDbName());
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return sendValidationError(res, { id: 'Missing or invalid invoice id' });
  }

  switch (req.method) {
    case 'GET':
      return await getInvoice(db, id, res);
    case 'PATCH':
    case 'PUT':
      return await updateInvoice(db, id, req.body, res);
    default:
      return sendMethodNotAllowed(res, ['GET', 'PATCH', 'PUT']);
  }
}

// 📄 GET: Fetch individual invoice
async function getInvoice(db: any, invoiceId: string, res: NextApiResponse) {
  try {
    if (!ObjectId.isValid(invoiceId)) {
      return sendValidationError(res, { id: 'Invalid invoice ID format' });
    }

    const invoice = await db.collection('invoices').findOne({ _id: new ObjectId(invoiceId) });
    
    if (!invoice) {
      return sendError(res, 'Invoice not found', 404);
    }

    return sendSuccess(res, invoice, 'Invoice retrieved successfully');
  } catch (err) {
    console.error('❌ Failed to fetch invoice:', err);
    return sendServerError(res, err, 'Failed to fetch invoice');
  }
}

// ✏️ PATCH/PUT: Update invoice
async function updateInvoice(db: any, invoiceId: string, updateData: any, res: NextApiResponse) {
  try {
    if (!ObjectId.isValid(invoiceId)) {
      return sendValidationError(res, { id: 'Invalid invoice ID format' });
    }

    // Get existing invoice
    const existingInvoice = await db.collection('invoices').findOne({ _id: new ObjectId(invoiceId) });
    
    if (!existingInvoice) {
      return sendError(res, 'Invoice not found', 404);
    }

    // Prepare update fields
    const updateFields: any = {
      ...updateData,
      updatedAt: new Date()
    };

    // Handle status changes
    if (updateData.status && updateData.status !== existingInvoice.status) {
      updateFields.statusChangedAt = new Date();
      updateFields.previousStatus = existingInvoice.status;
    }

    // Update invoice in database
    const result = await db.collection('invoices').updateOne(
      { _id: new ObjectId(invoiceId) },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return sendError(res, 'Invoice not found', 404);
    }

    // Get updated invoice for events
    const updatedInvoice = await db.collection('invoices').findOne({ _id: new ObjectId(invoiceId) });

    // 🔄 Create automation triggers for invoice updates
    if (updateData.status && existingInvoice.status !== updateData.status) {
      if (updateData.status === 'paid') {
        await triggerInvoiceAutomation(db, {
          invoiceId: invoiceId,
          locationId: existingInvoice.locationId,
          eventType: 'invoice-paid',
          contactId: existingInvoice.contactId,
          projectId: existingInvoice.projectId,
          amount: existingInvoice.total || existingInvoice.amount,
          invoiceNumber: existingInvoice.invoiceNumber
        });
      } else if (updateData.status === 'sent') {
        await triggerInvoiceAutomation(db, {
          invoiceId: invoiceId,
          locationId: existingInvoice.locationId,
          eventType: 'invoice-sent',
          contactId: existingInvoice.contactId,
          projectId: existingInvoice.projectId,
          amount: existingInvoice.total || existingInvoice.amount,
          invoiceNumber: existingInvoice.invoiceNumber
        });
      } else if (updateData.status === 'overdue') {
        await triggerInvoiceAutomation(db, {
          invoiceId: invoiceId,
          locationId: existingInvoice.locationId,
          eventType: 'invoice-overdue',
          contactId: existingInvoice.contactId,
          projectId: existingInvoice.projectId,
          amount: existingInvoice.total || existingInvoice.amount,
          invoiceNumber: existingInvoice.invoiceNumber
        });
      }
    }

    // Publish Ably event for invoice update
    await publishAblyEvent({
      locationId: existingInvoice.locationId,
      userId: req.headers['x-user-id'] as string || existingInvoice.assignedTo,
      entity: updatedInvoice,
      eventType: 'invoice.updated'
    });

    // Publish specific events based on what changed
    if (updateData.status && existingInvoice.status !== updateData.status) {
      await publishAblyEvent({
        locationId: existingInvoice.locationId,
        userId: req.headers['x-user-id'] as string || existingInvoice.assignedTo,
        entity: updatedInvoice,
        eventType: `invoice.${updateData.status}`
      });

      // Notify contact if status changed
      if (existingInvoice.contactId) {
        await publishAblyEvent({
          locationId: existingInvoice.locationId,
          userId: existingInvoice.contactId,
          entity: updatedInvoice,
          eventType: `invoice.${updateData.status}.notify`
        });
      }
    }

    // Publish payment received event if amount changed
    if (updateData.total && updateData.total !== existingInvoice.total) {
      await publishAblyEvent({
        locationId: existingInvoice.locationId,
        userId: req.headers['x-user-id'] as string || existingInvoice.assignedTo,
        entity: updatedInvoice,
        eventType: 'invoice.payment.received',
        data: {
          previousAmount: existingInvoice.total,
          newAmount: updateData.total,
          difference: updateData.total - existingInvoice.total
        }
      });
    }

    console.log('✅ Invoice updated successfully with automation triggers and Ably events');
    
    return sendSuccess(res, { 
      invoice: updatedInvoice,
      updated: true 
    }, 'Invoice updated successfully');

  } catch (err) {
    console.error('❌ Failed to update invoice:', err);
    return sendServerError(res, err, 'Failed to update invoice');
  }
}
