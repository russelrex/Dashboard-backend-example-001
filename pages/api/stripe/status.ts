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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return sendMethodNotAllowed(res, ['GET']);
  }

  try {
    const { 
      locationId, 
      customerId, 
      subscriptionId, 
      email,
      includePayments = false 
    } = req.query;

    if (!locationId && !customerId && !subscriptionId && !email) {
      return sendValidationError(res, { 
        identifier: 'One of locationId, customerId, subscriptionId, or email is required' 
      });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    let subscriptionQuery: any = {};
    let subscription = null;

    if (subscriptionId) {
      subscription = await db.collection('stripe_subscriptions').findOne({
        stripeSubscriptionId: subscriptionId
      });
    } else if (locationId) {
      subscription = await db.collection('stripe_subscriptions').findOne({
        locationId: new ObjectId(locationId as string)
      });
    } else if (customerId) {
      subscription = await db.collection('stripe_subscriptions').findOne({
        customerId: customerId as string
      });
    } else if (email) {
      subscription = await db.collection('stripe_subscriptions').findOne({
        customerEmail: email as string
      });
    }

    if (!subscription) {
      return sendError(res, 'No subscription found', 404);
    }

    let stripeSubscription: StripeSubscriptionData | null = null;
    let subscriptionStatus = subscription.status;

    if (subscription.stripeSubscriptionId) {
      try {
        stripeSubscription = await stripeHelpers.getSubscription(
          subscription.stripeSubscriptionId
        );
        subscriptionStatus = stripeSubscription.status;

        if (subscriptionStatus !== subscription.status) {
          await db.collection('stripe_subscriptions').updateOne(
            { _id: subscription._id },
            {
              $set: {
                status: subscriptionStatus,
                currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
                currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
                cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
                updatedAt: new Date(),
              }
            }
          );
        }
      } catch (error: any) {
      }
    }

    const responseData: any = {
      subscription: {
        id: subscription._id,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        customerId: subscription.customerId,
        customerEmail: subscription.customerEmail,
        locationId: subscription.locationId,
        status: subscriptionStatus,
        priceId: subscription.priceId,
        cancelAtPeriodEnd: stripeSubscription?.cancel_at_period_end || subscription.cancelAtPeriodEnd || false,
        currentPeriodStart: stripeSubscription 
          ? new Date(stripeSubscription.current_period_start * 1000)
          : subscription.currentPeriodStart,
        currentPeriodEnd: stripeSubscription 
          ? new Date(stripeSubscription.current_period_end * 1000)
          : subscription.currentPeriodEnd,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt,
      },
      isActive: ['active', 'trialing'].includes(subscriptionStatus),
      isPastDue: subscriptionStatus === 'past_due',
      isCanceled: ['canceled', 'unpaid'].includes(subscriptionStatus),
      willCancelAtPeriodEnd: stripeSubscription?.cancel_at_period_end || subscription.cancelAtPeriodEnd || false,
    };

    if (includePayments === 'true' || includePayments === 'true') {
      const payments = await db.collection('stripe_payments')
        .find({ 
          subscriptionId: subscription.stripeSubscriptionId 
        })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray();

      responseData.recentPayments = payments.map(payment => ({
        id: payment._id,
        invoiceId: payment.invoiceId,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        paidAt: payment.paidAt,
        createdAt: payment.createdAt,
      }));
    }

    if (stripeSubscription?.items?.data?.[0]) {
      const item = stripeSubscription.items.data[0];
      responseData.plan = {
        priceId: item.price.id,
        productId: item.price.product,
        amount: item.price.unit_amount,
        currency: item.price.currency,
        interval: item.price.recurring?.interval,
        intervalCount: item.price.recurring?.interval_count,
      };
    }

    if (responseData.subscription.currentPeriodEnd) {
      const now = new Date();
      const periodEnd = new Date(responseData.subscription.currentPeriodEnd);
      const daysUntilPeriodEnd = Math.ceil(
        (periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      responseData.daysUntilPeriodEnd = daysUntilPeriodEnd;
      
      if (responseData.willCancelAtPeriodEnd) {
        responseData.daysUntilCancellation = daysUntilPeriodEnd;
      } else {
        responseData.daysUntilNextBilling = daysUntilPeriodEnd;
      }
    }

    return sendSuccess(res, responseData);

  } catch (error: any) {
    if (error.type === 'StripeInvalidRequestError') {
      return sendError(res, `Invalid request: ${error.message}`, 400);
    }
    
    return sendServerError(res, 'Failed to check subscription status', error.message);
  }
} 