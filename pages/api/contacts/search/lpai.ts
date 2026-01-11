//lpai-backend\pages\api\contacts\search\lpai.ts

import axios from 'axios';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  sendSuccess,
  sendBadRequest,
  sendUnauthorized,
  sendServerError,
  sendPaginated,
} from '../../../../src/utils/httpResponses';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import cors from '@/lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    await cors(req, res);
  if (req.method !== 'GET') {
    return sendBadRequest(res, 'Method not allowed', 'Invalid Method');
  }

  const locationId = typeof req.query.locationId === 'string' ? req.query.locationId : null;
  const countOnly = req.query.countOnly === 'true';
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  const search = (req.query.search as string)?.trim();

  if (!locationId) {
    return sendBadRequest(res, 'Missing required field: locationId');
  }

  const client = await clientPromise;
  const db = client.db(getDbName());

  const query: any = {
    locationId,
    ghlContactId: { $exists: true },
    // ADDED: Filter out soft-deleted contacts
    deletedAt: { $exists: false }
  };

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
    ];
  }

  try {
    if (countOnly) {
      const total = await db.collection('contacts').countDocuments(query);
      return sendSuccess(res, { total }, 'Total contacts count fetched');
    }

    const total = await db.collection('contacts').countDocuments(query);
    const contacts = await db
      .collection('contacts')
      .find(query)
      .skip(skip)
      .limit(limit)
      .toArray();
  
    return sendPaginated(res, contacts, {
      page,
      limit,
      total,
    });
  } catch (error: any) {
    console.error('❌ Failed to fetch contacts from database:', error);
    return sendServerError(res, error, 'Error retrieving contacts from database');
  }
}