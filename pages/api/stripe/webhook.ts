import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { stripeHelpers, StripeSubscriptionData } from '../../../src/lib/stripe';
import { ObjectId } from 'mongodb';
import Stripe from 'stripe';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function getRawBody(req: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  
  return new Promise((resolve, reject) => {
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    
    req.on('error', reject);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = await getRawBody(req);
    const signature = req.headers['stripe-signature'] as string;

    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }

    let event: Stripe.Event;
    try {
      event = stripeHelpers.constructEvent(body, signature);
    } catch (err: any) {
      return res.status(400).json({ error: 'Webhook signature verification failed' });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(db, event.data.object as Stripe.Checkout.Session);
        break;

      case 'checkout.session.async_payment_succeeded':
        await handleCheckoutSessionAsyncPaymentSucceeded(db, event.data.object as Stripe.Checkout.Session);
        break;

      case 'checkout.session.expired':
        await handleCheckoutSessionExpired(db, event.data.object as Stripe.Checkout.Session);
        break;

      case 'charge.succeeded':
        await handleChargeSucceeded(db, event.data.object as Stripe.Charge);
        break;

      case 'customer.subscription.created':
        await handleSubscriptionCreated(db, event.data.object as unknown as StripeSubscriptionData);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(db, event.data.object as unknown as StripeSubscriptionData);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(db, event.data.object as unknown as StripeSubscriptionData);
        break;

      case 'customer.subscription.paused':
        await handleSubscriptionPaused(db, event.data.object as unknown as StripeSubscriptionData);
        break;

      case 'customer.subscription.resumed':
        await handleSubscriptionResumed(db, event.data.object as unknown as StripeSubscriptionData);
        break;

      case 'customer.subscription.trial_will_end':
        await handleSubscriptionTrialWillEnd(db, event.data.object as unknown as StripeSubscriptionData);
        break;

      case 'customer.updated':
        await handleCustomerUpdated(db, event.data.object as Stripe.Customer);
        break;

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(db, event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(db, event.data.object as Stripe.Invoice);
        break;

      case 'invoice.finalization_failed':
        await handleInvoiceFinalizationFailed(db, event.data.object as Stripe.Invoice);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
        break;
    }

    await db.collection('stripe_webhook_events').insertOne({
      eventId: event.id,
      eventType: event.type,
      processed: true,
      processedAt: new Date(),
      data: event.data.object,
    });

    res.status(200).json({ received: true });

  } catch (error: any) {
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

async function handleCheckoutSessionCompleted(db: any, session: Stripe.Checkout.Session) {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2025-08-27.basil',
    });

    let customerDetails = {};
    if (session.customer) {
      try {
        const customer = await stripe.customers.retrieve(session.customer as string);
        if ('deleted' in customer) {
          console.warn('Customer was deleted:', session.customer);
        } else {
          customerDetails = {
            customerPhone: session.customer_details?.phone || customer.phone,
            customerBillingAddress: customer.address || session.customer_details?.address,
          };
        }
      } catch (customerError) {
        console.error('Error retrieving customer details:', customerError);
      }
    }

    await db.collection('subscriptions').updateOne(
      { sessionId: session.id },
      {
        $set: {
          status: 'active',
          stripeSubscriptionId: session.subscription,
          ...customerDetails,
          updatedAt: new Date(),
        }
      }
    );

    if (session.metadata?.locationId) {
      await db.collection('locations').updateOne(
        { locationId: session.metadata.locationId },
        {
          $set: {
            stripeCustomerId: session.customer,
            stripeSubscriptionId: session.subscription,
            subscriptionStatus: 'active',
            subscriptionUpdatedAt: new Date(),
          }
        }
      );

      await db.collection('users').updateMany(
        { locationId: session.metadata.locationId },
        {
          $set: {
            subscriptionStatus: 'active',
            subscriptionUpdatedAt: new Date(),
          }
        }
      );
    }

  } catch (error) {
    throw error;
  }
}

async function handleSubscriptionCreated(db: any, subscription: StripeSubscriptionData) {
  try {
    await db.collection('subscriptions').updateOne(
      { stripeSubscriptionId: subscription.id },
      {
        $set: {
          status: subscription.status,
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          updatedAt: new Date(),
        }
      }
    );

  } catch (error) {
    throw error;
  }
}

async function handleSubscriptionUpdated(db: any, subscription: StripeSubscriptionData) {
  try {
    console.log('Processing customer.subscription.updated:', subscription);

    await db.collection('subscriptions').updateOne(
      { stripeSubscriptionId: subscription.id },
      {
        $set: {
          status: subscription.status,
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          seatCount: subscription.items.data[0]?.quantity,
          updatedAt: new Date(),
        }
      }
    );

    const locationUpdateResult = await db.collection('locations').updateOne(
      { 'saaSPlanData.stripeSubscriptionId': subscription.id },
      {
        $set: {
          subscriptionStatus: subscription.status,
          subscriptionUpdatedAt: new Date(),
          'saaSPlanData.additionalSeatCount': subscription.items.data[0]?.quantity - 1,
          'saaSPlanData.seatCount': subscription.items.data[0]?.quantity,
          'saaSPlanData.updatedAt': new Date().toISOString(),
          'saaSPlanData.status': subscription.status
        }
      }
    );

    if (locationUpdateResult.matchedCount > 0) {
      const location = await db.collection('locations').findOne(
        { 'saaSPlanData.stripeSubscriptionId': subscription.id }
      );

      if (location?.locationId) {
        await db.collection('users').updateMany(
          { locationId: location.locationId },
          {
            $set: {
              subscriptionStatus: subscription.status,
              subscriptionUpdatedAt: new Date(),
            }
          }
        );
      }
    }
  } catch (error) {
    throw error;
  }
}

async function handleSubscriptionDeleted(db: any, subscription: StripeSubscriptionData) {
  try {
    await db.collection('subscriptions').updateOne(
      { stripeSubscriptionId: subscription.id },
      {
        $set: {
          status: 'canceled',
          canceledAt: new Date(),
          updatedAt: new Date(),
        }
      }
    );

    const subscriptionRecord = await db.collection('subscriptions')
      .findOne({ stripeSubscriptionId: subscription.id });

    if (subscriptionRecord?.locationId) {
      await db.collection('locations').updateOne(
        { locationId: subscriptionRecord.locationId },
        {
          $set: {
            subscriptionStatus: 'canceled',
            subscriptionUpdatedAt: new Date(),
          }
        }
      );

      await db.collection('users').updateMany(
        { locationId: subscriptionRecord.locationId },
        {
          $set: {
            subscriptionStatus: 'canceled',
            subscriptionUpdatedAt: new Date(),
          }
        }
      );
    }

  } catch (error) {
    throw error;
  }
}

async function handleCustomerUpdated(db: any, customer: Stripe.Customer) {
  try {
    const customerDetails = {
      customerPhone: customer.phone,
      customerBillingAddress: customer.address,
    };

    await db.collection('subscriptions').updateMany(
      { customerId: customer.id },
      {
        $set: {
          ...customerDetails,
          updatedAt: new Date(),
        }
      }
    );

    console.log(`Updated customer details for customer: ${customer.id}`);

  } catch (error) {
    console.error('Error handling customer updated:', error);
    throw error;
  }
}

async function handleCheckoutSessionAsyncPaymentSucceeded(db: any, session: Stripe.Checkout.Session) {
  try {
    await handleCheckoutSessionCompleted(db, session);
    console.log(`Async payment succeeded for session: ${session.id}`);
  } catch (error) {
    console.error('Error handling async payment succeeded:', error);
    throw error;
  }
}

async function handleCheckoutSessionExpired(db: any, session: Stripe.Checkout.Session) {
  try {
    await db.collection('subscriptions').updateOne(
      { sessionId: session.id },
      {
        $set: {
          status: 'expired',
          expiredAt: new Date(),
          updatedAt: new Date(),
        }
      }
    );

    console.log(`Checkout session expired: ${session.id}`);
  } catch (error) {
    console.error('Error handling checkout session expired:', error);
    throw error;
  }
}

async function handleChargeSucceeded(db: any, charge: Stripe.Charge) {
  try {
    await db.collection('charges').insertOne({
      chargeId: charge.id,
      customerId: charge.customer,
      amount: charge.amount,
      currency: charge.currency,
      status: 'succeeded',
      receiptUrl: charge.receipt_url,
      createdAt: new Date(charge.created * 1000),
      processedAt: new Date(),
    });

    console.log(`Charge succeeded: ${charge.id}`);
  } catch (error) {
    console.error('Error handling charge succeeded:', error);
    throw error;
  }
}

async function handleSubscriptionPaused(db: any, subscription: StripeSubscriptionData) {
  try {
    await db.collection('subscriptions').updateOne(
      { stripeSubscriptionId: subscription.id },
      {
        $set: {
          status: 'paused',
          pausedAt: new Date(),
          updatedAt: new Date(),
        }
      }
    );

    const locationUpdateResult = await db.collection('locations').updateOne(
      { 'saaSPlanData.stripeSubscriptionId': subscription.id },
      {
        $set: {
          subscriptionStatus: 'paused',
          subscriptionUpdatedAt: new Date(),
        }
      }
    );

    if (locationUpdateResult.matchedCount > 0) {
      const location = await db.collection('locations').findOne(
        { 'saaSPlanData.stripeSubscriptionId': subscription.id }
      );

      if (location?.locationId) {
        await db.collection('users').updateMany(
          { locationId: location.locationId },
          {
            $set: {
              subscriptionStatus: 'paused',
              subscriptionUpdatedAt: new Date(),
            }
          }
        );
      }
    }

    console.log(`Subscription paused: ${subscription.id}`);
  } catch (error) {
    console.error('Error handling subscription paused:', error);
    throw error;
  }
}

async function handleSubscriptionResumed(db: any, subscription: StripeSubscriptionData) {
  try {
    await db.collection('subscriptions').updateOne(
      { stripeSubscriptionId: subscription.id },
      {
        $set: {
          status: subscription.status,
          resumedAt: new Date(),
          updatedAt: new Date(),
        },
        $unset: {
          pausedAt: 1
        }
      }
    );

    const locationUpdateResult = await db.collection('locations').updateOne(
      { 'saaSPlanData.stripeSubscriptionId': subscription.id },
      {
        $set: {
          subscriptionStatus: subscription.status,
          subscriptionUpdatedAt: new Date(),
        }
      }
    );

    if (locationUpdateResult.matchedCount > 0) {
      const location = await db.collection('locations').findOne(
        { 'saaSPlanData.stripeSubscriptionId': subscription.id }
      );

      if (location?.locationId) {
        await db.collection('users').updateMany(
          { locationId: location.locationId },
          {
            $set: {
              subscriptionStatus: subscription.status,
              subscriptionUpdatedAt: new Date(),
            }
          }
        );
      }
    }

    console.log(`Subscription resumed: ${subscription.id}`);
  } catch (error) {
    console.error('Error handling subscription resumed:', error);
    throw error;
  }
}

async function handleSubscriptionTrialWillEnd(db: any, subscription: StripeSubscriptionData) {
  try {
    await db.collection('subscription_notifications').insertOne({
      type: 'trial_will_end',
      subscriptionId: subscription.id,
      customerId: subscription.customer,
      trialEndDate: new Date(subscription.current_period_end * 1000),
      notifiedAt: new Date(),
    });

    console.log(`Trial will end notification for subscription: ${subscription.id}`);
  } catch (error) {
    console.error('Error handling trial will end:', error);
    throw error;
  }
}

async function handleInvoiceFinalizationFailed(db: any, invoice: Stripe.Invoice) {
  try {
    await db.collection('invoice_errors').insertOne({
      invoiceId: invoice.id,
      subscriptionId: (invoice as any).subscription || null,
      customerId: invoice.customer,
      error: 'finalization_failed',
      amount: invoice.amount_due,
      currency: invoice.currency,
      createdAt: new Date(),
    });

    console.log(`Invoice finalization failed: ${invoice.id}`);
  } catch (error) {
    console.error('Error handling invoice finalization failed:', error);
    throw error;
  }
}

async function handlePaymentSucceeded(db: any, invoice: Stripe.Invoice) {
  try {
    const subscriptionId = invoice?.parent?.subscription_details?.subscription;
    const res = await db.collection('payments').insertOne({
      invoiceId: invoice.id,
      subscriptionId: subscriptionId,
      customerId: invoice.customer,
      amount: invoice.amount_paid,
      currency: invoice.currency,
      status: 'succeeded',
      paidAt: new Date(invoice.status_transitions.paid_at! * 1000),
      createdAt: new Date(),
    });

  } catch (error) {
    throw error;
  }
}

async function handlePaymentFailed(db: any, invoice: Stripe.Invoice) {
  try {
    const subscriptionId = invoice?.parent?.subscription_details?.subscription;
    await db.collection('payments').insertOne({
      invoiceId: invoice.id,
      subscriptionId: subscriptionId,
      customerId: invoice.customer,
      amount: invoice.amount_due,
      currency: invoice.currency,
      status: 'failed',
      createdAt: new Date(),
    });

  } catch (error) {
    throw error;
  }
} 