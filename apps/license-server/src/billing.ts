import Stripe from 'stripe';
import type { SubscriptionUpdate } from './store.js';

export type Interval = 'monthly' | 'yearly';

/** What the server needs from Stripe (a fake implements it in tests). */
export interface Billing {
  /** Intervals with a configured price. */
  intervals(): Interval[];
  createCheckout(opts: {
    userId: string;
    email: string;
    customerId: string | null;
    interval: Interval;
    successUrl: string;
    cancelUrl: string;
  }): Promise<string>;
  createPortal(customerId: string, returnUrl: string): Promise<string>;
  /** Verifies the signature and parses a webhook delivery (throws when invalid). */
  parseEvent(rawBody: Buffer, signature: string): Stripe.Event;
  subscription(id: string): Promise<SubscriptionUpdate>;
  cancelNow(subscriptionId: string): Promise<void>;
}

/** Normalized state of a subscription (period end lives on the items since API 2025-03-31). */
export function subscriptionUpdate(sub: Stripe.Subscription): SubscriptionUpdate {
  const ends = sub.items.data.map((i) => i.current_period_end).filter((n) => typeof n === 'number');
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  return {
    customerId,
    subscriptionId: sub.id,
    status: sub.status,
    currentPeriodEnd: ends.length ? new Date(Math.max(...ends) * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
}

export class StripeBilling implements Billing {
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
    private readonly prices: Partial<Record<Interval, string>>,
  ) {
    this.stripe = new Stripe(secretKey, { appInfo: { name: 'TokTok Game Connector Live' } });
  }

  intervals(): Interval[] {
    return (Object.keys(this.prices) as Interval[]).filter((k) => this.prices[k]);
  }

  async createCheckout(opts: Parameters<Billing['createCheckout']>[0]): Promise<string> {
    const price = this.prices[opts.interval];
    if (!price) throw new Error(`Aucun prix Stripe pour ${opts.interval}`);
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      client_reference_id: opts.userId,
      ...(opts.customerId ? { customer: opts.customerId } : { customer_email: opts.email }),
      subscription_data: { metadata: { userId: opts.userId } },
      allow_promotion_codes: true,
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
    });
    if (!session.url) throw new Error('Stripe n’a pas renvoyé d’URL de paiement');
    return session.url;
  }

  async createPortal(customerId: string, returnUrl: string): Promise<string> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  }

  parseEvent(rawBody: Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }

  async subscription(id: string): Promise<SubscriptionUpdate> {
    return subscriptionUpdate(await this.stripe.subscriptions.retrieve(id));
  }

  async cancelNow(subscriptionId: string): Promise<void> {
    await this.stripe.subscriptions.cancel(subscriptionId);
  }
}
