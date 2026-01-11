// lpai-backend/pages/api/invoices/ghl/[id].ts
// 2025-08-17

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  sendSuccess,
  sendBadRequest,
  sendUnauthorized,
  sendServerError,
} from '../../../../src/utils/httpResponses';
import axios from 'axios';
import { GHL_ENDPOINTS } from '../../../../constants/ghl';
import { getAuthHeader } from '@/utils/ghlAuth';
import { getLocation } from '@/utils/getLocation';
import cors from '@/lib/cors';
import { invoiceSchema } from '../../../../schemas/invoice.schema';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import { triggerInvoiceAutomation } from '@/utils/automations/triggerHelper';
import { publishAblyEvent } from '@/utils/ably/publishEvent';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const { id } = req.query;

  if (typeof id !== 'string') {
    return sendBadRequest(res, 'Invalid invoice ID');
  }

  switch (req.method) {
    case 'GET':
      return sendBadRequest(res, 'Method Not Allowed');
    case 'PUT':
      await updateInvoice(id, req.body, res);
    case 'DELETE':
      await deleteInvoice(id, req.body, res);
      break;
    default:
      res.setHeader('Allow', ['GET', 'PATCH', 'DELETE']);
      res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  async function deleteInvoice(id: string, body: any, res: NextApiResponse) {  
    try {
      const { locationId, lpaiID} = body;
      const location = await getLocation(locationId);
      if (!location) {
        return sendUnauthorized(res, 'Invalid location or missing credentials');
      }
  
      const auth = await getAuthHeader(location);
  
      const options = {
        method: 'DELETE',
        url: GHL_ENDPOINTS.INVOICES.byId(id),
        params: {altId: locationId, altType: 'location'},
        headers: {Authorization: auth.header, Version: '2021-07-28', Accept: 'application/json'}
      };

      const { data } = await axios.request(options);

      const client = await clientPromise;
      const db = client.db(getDbName());
      const _id = lpaiID as string;
      
      // Get invoice details before deletion for automation triggers
      const invoice = await db.collection('invoices').findOne({ _id: new ObjectId(_id) });
      
      await db.collection('invoices').deleteOne({
        _id: new ObjectId(_id),
      });
      
      // Create automation trigger for invoice deletion
      if (invoice) {
        await triggerInvoiceAutomation(db, {
          invoiceId: _id,
          locationId: locationId,
          eventType: 'invoice-deleted',
          contactId: invoice?.contactId,
          projectId: invoice?.projectId,
          amount: invoice?.total || invoice?.amount,
          invoiceNumber: invoice?.invoiceNumber
        });
        
        // Publish Ably event for invoice deletion
        await publishAblyEvent({
          locationId: locationId,
          userId: req.headers['x-user-id'] as string,
          entity: { _id: _id },
          eventType: 'invoice.deleted'
        });
      }
  
      return sendSuccess(res, data, 'Invoice deleted successfully');
    } catch (error: any) {
      console.error('❌ Invoice deletion error:', error);
  
      if (error.name === 'ValidationError') {
        return sendBadRequest(res, 'Validation failed', error.errors);
      }
  
      const message = error.response?.data?.message || 'Unexpected error occurred';
      const data = error.response?.data || null;
  
      return sendServerError(res, message, data);
    }
  }

  async function updateInvoice(id: string, req: NextApiRequest, res: NextApiResponse) {
    try {
      const validated = await invoiceSchema.validate(req.body, { abortEarly: false });
      const locationId = validated.altId;

      if (!locationId) {
        return sendBadRequest(res, 'Missing locationId');
      }
  
      const location = await getLocation(locationId);
      if (!location) {
        return sendUnauthorized(res, 'Invalid location or missing credentials');
      }
  
      const auth = await getAuthHeader(location);
  
      const options = {
        method: 'PUT',
        url: GHL_ENDPOINTS.INVOICES.byId(id),
        headers: {
          Authorization: auth.header,
          Version: '2021-07-28',
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        data: validated,
      };
  
      const { data } = await axios.request(options);
  
      return sendSuccess(res, data, 'Invoice updated successfully');
    } catch (error: any) {
      console.error('❌ Invoice update error:', error);
  
      if (error.name === 'ValidationError') {
        return sendBadRequest(res, 'Validation failed', error.errors);
      }
  
      const message = error.response?.data?.message || 'Unexpected error occurred';
      const data = error.response?.data || null;
  
      return sendServerError(res, message, data);
    }
  }
  
}
