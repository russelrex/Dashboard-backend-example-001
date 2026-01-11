import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { stripeHelpers } from '../../../src/lib/stripe';
import { 
  sendSuccess, 
  sendError, 
  sendValidationError,
  sendServerError,
  sendMethodNotAllowed 
} from '../../../src/utils/response';
import { ObjectId } from 'mongodb';
import cors from '@/lib/cors';

function toObjectId(id: any) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  if (typeof id === 'string' && ObjectId.isValid(id)) return new ObjectId(id);
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (req.method !== 'POST') {
    return sendMethodNotAllowed(res, ['POST']);
  }

  try {
    const { 
      email, 
      name, 
      userId, 
      priceId, 
      successUrl, 
      cancelUrl,
      seatCount = 1, 
      metadata = {},
      _trialPeriodDays,
      allowPromotionalCodes
    } = req.body;

    if (!email) {
      return sendValidationError(res, { email: 'Email is required' });
    }

    if (!successUrl || !cancelUrl) {
      return sendValidationError(res, { 
        urls: 'Success URL and Cancel URL are required' 
      });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    let user = null;
    if (userId) {
      const userObjectId = toObjectId(userId);
      if (!userObjectId) {
        return sendValidationError(res, { userId: 'Invalid user ID format' });
      }

      user = await db.collection('users').findOne({ 
        _id: userObjectId
      });
      
      if (!user) {
        return sendValidationError(res, { userId: 'Invalid user ID' });
      }
    }

    const customer = await stripeHelpers.createOrRetrieveCustomer(
      email, 
      name || (user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : undefined),
      {
        userId: userId || '',
        source: 'ghl-saas',
        ...metadata
      }
    );

    const session = await stripeHelpers.createCheckoutSession({
      customerId: customer.id,
      priceId,
      seatCount,
      successUrl,
      cancelUrl,
      metadata: {
        userId: userId || '',
        customerId: customer.id,
        seatCount,
        ...metadata
      },
      mode: 'subscription',
      _trialPeriodDays,
      allowPromotionalCodes
    });

    const subscriptionIntent = {
      sessionId: session.id,
      sessionUrl: session.url,
      customerId: customer.id,
      customerEmail: email,
      customerPhone: null,
      customerBillingAddress: null,
      userId: userId ? toObjectId(userId) : null,
      status: 'pending',
      priceId: priceId,
      seatCount,
      metadata,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('subscriptions').insertOne(subscriptionIntent);

    return sendSuccess(res, {
      sessionId: session.id,
      sessionUrl: session.url,
      customerId: customer.id,
      message: 'Subscription checkout session created successfully'
    });

  } catch (error: any) {
    if (error.type === 'StripeCardError') {
      return sendError(res, `Payment failed: ${error.message}`, 400);
    }
    
    if (error.type === 'StripeInvalidRequestError') {
      return sendError(res, `Invalid request: ${error.message}`, 400);
    }
    
    return sendServerError(res, 'Failed to create subscription', error.message);
  }
} 