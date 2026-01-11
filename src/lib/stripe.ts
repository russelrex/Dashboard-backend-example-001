import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-08-27.basil',
  typescript: true,
});

export const STRIPE_CONFIG = {
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY!,
  secretKey: process.env.STRIPE_SECRET_KEY!,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
};

if (!STRIPE_CONFIG.secretKey) {
  throw new Error('STRIPE_SECRET_KEY is required');
}

export default stripe;

export type StripeSubscriptionStatus = 
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'paused';

export interface StripeSubscriptionData {
  id: string;
  status: StripeSubscriptionStatus;
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end: boolean;
  customer: string;
  items: {
    data: Array<{
      id: string;
      quantity: number;
      price: {
        id: string;
        product: string;
        unit_amount: number;
        currency: string;
        recurring?: {
          interval: string;
          interval_count: number;
        };
      };
    }>;
  };
}

export const stripeHelpers = {
  async createSubscription(
    customerId: string, 
    priceId?: string,
    seatCount: number = 1) 
  {
    return await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId, quantity: seatCount }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    });
  },

  async createOrRetrieveCustomer(email: string, name?: string, metadata?: Record<string, string>) {
    const existingCustomers = await stripe.customers.list({
      email,
      limit: 1,
    });

    if (existingCustomers.data.length > 0) {
      return existingCustomers.data[0];
    }

    return await stripe.customers.create({
      email,
      name,
      metadata,
    });
  },

  async createCheckoutSession(params: {
    customerId?: string;
    customerEmail?: string;
    priceId?: string;
    seatCount?: number;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
    mode?: 'subscription' | 'payment';
    _trialPeriodDays?: number;
    allowPromotionalCodes?: boolean;
  }) {
    const {
      customerId,
      customerEmail,
      priceId,
      successUrl,
      seatCount,
      cancelUrl,
      metadata,
      mode = 'subscription',
      _trialPeriodDays = 21,
      allowPromotionalCodes = false,
    } = params;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode,
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          price: priceId,
          quantity: seatCount,
        },
      ],
      metadata,
      billing_address_collection: 'required',
      phone_number_collection: {
        enabled: true,
      },
      customer: customerId,
      customer_email: customerEmail,
    };

    if (allowPromotionalCodes) {
      sessionParams.allow_promotion_codes = true;
      sessionParams.payment_method_collection = 'if_required';
      sessionParams.subscription_data = {};
    } else {
      sessionParams.subscription_data = {
        trial_period_days: _trialPeriodDays,
      };
    }

    // if (_trialPeriodDays > 0) {
    //   sessionParams.subscription_data = {
    //     trial_period_days: _trialPeriodDays,
    //   };
    // }

    return await stripe.checkout.sessions.create(sessionParams);
  },

  async getSubscription(subscriptionId: string): Promise<StripeSubscriptionData> {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    return subscription as unknown as StripeSubscriptionData;
  },

  async updateSubscription(subscriptionId: string, params: any): Promise<StripeSubscriptionData> {
    const subscription = await stripe.subscriptions.update(subscriptionId, params);
    return subscription as unknown as StripeSubscriptionData;
  },

  async cancelSubscription(subscriptionId: string): Promise<StripeSubscriptionData> {
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
    return subscription as unknown as StripeSubscriptionData;
  },

  async cancelSubscriptionImmediately(subscriptionId: string): Promise<StripeSubscriptionData> {
    const subscription = await stripe.subscriptions.cancel(subscriptionId);
    return subscription as unknown as StripeSubscriptionData;
  },

  async createBillingPortalSession(customerId: string, returnUrl: string) {
    return await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  },

  constructEvent(payload: string | Buffer, signature: string) {
    return stripe.webhooks.constructEvent(
      payload,
      signature,
      STRIPE_CONFIG.webhookSecret
    );
  },
}; 