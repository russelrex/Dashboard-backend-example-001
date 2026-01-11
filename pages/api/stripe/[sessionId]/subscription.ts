import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import cors from '@/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError, sendNotFound } from '../../../../src/utils/httpResponses';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  return await getSubscriptionBySessionId(req, res);
}

async function getSubscriptionBySessionId(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const { sessionId } = req.query;

    if (!sessionId || typeof sessionId !== 'string') {
      return sendBadRequest(res, 'sessionId is required');
    }

    const subscription = await db.collection('subscriptions').findOne({ 
      sessionId: sessionId 
    });

    if (!subscription) {
      return sendNotFound(res, 'Subscription not found for this sessionId');
    }

    return sendSuccess(res, {
      subscription: subscription
    }, 'Subscription retrieved successfully');

  } catch (error) {
    return sendServerError(res, 'Failed to retrieve subscription');
  }
}
