import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { stripeHelpers, StripeSubscriptionData } from '../../../src/lib/stripe';
import { 
  sendSuccess, 
  sendError, 
  sendValidationError,
  sendServerError,
  sendMethodNotAllowed 
} from '../../../src/utils/response';
import { ObjectId } from 'mongodb';
import cors from '@/lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (!['POST', 'PUT', 'DELETE', 'GET'].includes(req.method!)) {
    return sendMethodNotAllowed(res, ['POST', 'PUT', 'DELETE', 'GET']);
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    switch (req.method) {
      case 'GET':
        return await getBillingPortal(db, req, res);
      case 'POST':
        return await createBillingPortal(db, req, res);
      case 'PUT':
        return await updateSubscription(db, req, res);
      case 'DELETE':
        return await cancelSubscription(db, req, res);
      default:
        return sendMethodNotAllowed(res, ['POST', 'PUT', 'DELETE', 'GET']);
    }

  } catch (error: any) {
    return sendServerError(res, 'Failed to manage subscription', error.message);
  }
}

async function getBillingPortal(db: any, req: NextApiRequest, res: NextApiResponse) {
  return await createBillingPortal(db, req, res);
}

async function createBillingPortal(db: any, req: NextApiRequest, res: NextApiResponse) {
  const { customerId, locationId, returnUrl } = req.body;

  if (!customerId && !locationId) {
    return sendValidationError(res, { 
      customer: 'Either customerId or locationId is required' 
    });
  }

  if (!returnUrl) {
    return sendValidationError(res, { returnUrl: 'Return URL is required' });
  }

  try {
    let finalCustomerId = customerId;

    if (!finalCustomerId && locationId) {
      const location = await db.collection('locations').findOne({
        locationId
      });

      if (!location?.stripeCustomerId) {
        return sendError(res, 'No Stripe customer found for this location', 404);
      }

      finalCustomerId = location.stripeCustomerId;
    }

    const session = await stripeHelpers.createBillingPortalSession(
      finalCustomerId,
      returnUrl
    );

    return sendSuccess(res, {
      portalUrl: session.url,
      customerId: finalCustomerId,
      message: 'Billing portal session created successfully'
    });

  } catch (error: any) {
    if (error.type === 'StripeInvalidRequestError') {
      return sendError(res, `Invalid request: ${error.message}`, 400);
    }
    
    throw error;
  }
}

async function updateSubscription(db: any, req: NextApiRequest, res: NextApiResponse) {
  const { locationId, seatCount } = req.body;

  if (!locationId) {
    return sendValidationError(res, { 
      subscription: 'Either subscriptionId or locationId is required' 
    });
  }

  try {
    let finalSubscriptionId;

    const locationResult = await db.collection('locations').findOne({
      locationId
    });

    if (!locationResult?.saaSPlanData?.stripeSubscriptionId) {
      return sendError(res, 'No active subscription found for this location', 404);
    }

    finalSubscriptionId = locationResult.saaSPlanData.stripeSubscriptionId;

    const subscription: StripeSubscriptionData = await stripeHelpers.getSubscription(finalSubscriptionId);

    if (!subscription) {
      return sendError(res, 'Subscription not found', 404);
    }

    const updateParams: any = {};
    const currentItem = subscription.items.data[0];

    if (locationResult.saaSPlanData.stripePriceId && locationResult.saaSPlanData.stripePriceId !== currentItem.price.id) {
      updateParams.items = [{
        id: currentItem.id,
        price: locationResult.saaSPlanData.stripePriceId,
      }];
      updateParams.proration_behavior = 'always_invoice';
    }

    const targetSeatCount = seatCount || locationResult.saaSPlanData.seatCount;
    
    if (targetSeatCount && targetSeatCount !== currentItem.quantity) {
      updateParams.items = [{
        id: currentItem.id,
        price: currentItem.price.id,
        quantity: targetSeatCount,
      }];
      updateParams.proration_behavior = 'create_prorations';
    }

    if (locationResult.saaSPlanData.cancelAtPeriodEnd !== undefined) {
      updateParams.cancel_at_period_end = locationResult.saaSPlanData.cancelAtPeriodEnd;
    }

    let updatedSubscription = subscription;
    if (Object.keys(updateParams).length > 0) {
      updatedSubscription = await stripeHelpers.updateSubscription(finalSubscriptionId, updateParams);
    }

    await db.collection('subscriptions').updateOne(
      { stripeSubscriptionId: finalSubscriptionId },
      {
        $set: {
          status: updatedSubscription.status,
          cancelAtPeriodEnd: updatedSubscription.cancel_at_period_end,
          currentPeriodStart: new Date(updatedSubscription.current_period_start * 1000),
          currentPeriodEnd: new Date(updatedSubscription.current_period_end * 1000),
          seatCount: updatedSubscription.items.data[0].quantity,
          updatedAt: new Date(),
        }
      }
    );

    return sendSuccess(res, {
      subscription: {
        id: updatedSubscription.id,
        status: updatedSubscription.status,
        cancelAtPeriodEnd: updatedSubscription.cancel_at_period_end,
        currentPeriodEnd: new Date(updatedSubscription.current_period_end * 1000),
        priceId: updatedSubscription.items.data[0].price.id,
        seatCount: updatedSubscription.items.data[0].quantity,
      },
      message: 'Subscription updated successfully'
    });

  } catch (error: any) {
    if (error.type === 'StripeInvalidRequestError') {
      return sendError(res, `Invalid request: ${error.message}`, 400);
    }
    
    throw error;
  }
}

async function cancelSubscription(db: any, req: NextApiRequest, res: NextApiResponse) {
  const { locationId } = req.body;

  if ( !locationId) {
    return sendValidationError(res, { 
      subscription: 'Either subscriptionId or locationId is required' 
    });
  }

  try {
    let finalSubscriptionId;

    if (locationId) {
      const location = await db.collection('locations').findOne({
        locationId
      });

      if (!location?.saaSPlanData?.stripeSubscriptionId) {
        return sendError(res, 'No active subscription found for this location', 404);
      }

      finalSubscriptionId = location.saaSPlanData.stripeSubscriptionId;
    }

    const canceledSubscription = await stripeHelpers.cancelSubscriptionImmediately(finalSubscriptionId);

    const updateData: any = {
      status: canceledSubscription.status,
      cancelAtPeriodEnd: canceledSubscription.cancel_at_period_end,
      updatedAt: new Date(),
    };

    updateData.canceledAt = new Date();

    await db.collection('subscriptions').updateOne(
      { stripeSubscriptionId: finalSubscriptionId },
      { $set: updateData }
    );

    await db.collection('locations').updateOne(
      { locationId },
      {
        $set: {
          'saaSPlanData.status': canceledSubscription.status,
          subscriptionStatus: canceledSubscription.status,
          subscriptionUpdatedAt: new Date(),
        }
      }
    );

    return sendSuccess(res, {
      subscription: {
        id: canceledSubscription.id,
        status: canceledSubscription.status,
        cancelAtPeriodEnd: canceledSubscription.cancel_at_period_end,
        currentPeriodEnd: new Date(canceledSubscription.current_period_end * 1000),
      },
      message: 'Subscription canceled immediately'
    });

  } catch (error: any) {
    if (error.type === 'StripeInvalidRequestError') {
      return sendError(res, `Invalid request: ${error.message}`, 400);
    }
    
    throw error;
  }
} 