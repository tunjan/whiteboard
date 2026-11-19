import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Plan } from '@whiteboard/shared';
import { currentTutor, requireTutor } from '../auth/middleware';
import { db } from '../db/client';
import { tutors } from '../db/schema';
import { env } from '../env';

/**
 * The hosted Pro plan, through Stripe: Checkout to subscribe, the customer
 * portal to change or cancel, and a webhook that keeps `tutors.plan` in step.
 * On only when `STRIPE_SECRET_KEY` is set. Plain `fetch` against three
 * endpoints and a hand-checked signature, rather than the SDK.
 */

/** POST a form to the Stripe API and return its JSON, or throw with Stripe's message. */
async function stripe(path: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = (body.error as { message?: string } | undefined)?.message;
    throw new Error(`Stripe ${path}: ${message ?? res.status}`);
  }
  return body;
}

/** How long a signed webhook stays acceptable, against replays. Stripe's own default. */
const TOLERANCE_S = 300;

/**
 * Whether `payload` is what Stripe signed: the `Stripe-Signature` header's
 * `t` and any `v1` HMAC-SHA256 of `${t}.${payload}` under the endpoint secret.
 */
export function verifyStripeSignature(
  payload: string,
  header: string | undefined,
  secret: string,
  nowS = Math.floor(Date.now() / 1000),
): boolean {
  if (!header || !secret) return false;
  const parts = header.split(',').map((part) => part.split('=', 2) as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  if (!Number.isFinite(t) || Math.abs(nowS - t) > TOLERANCE_S) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest();
  return parts.some(([k, v]) => {
    if (k !== 'v1' || !v) return false;
    const given = Buffer.from(v, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/**
 * The plan a subscription status buys. `past_due` keeps Pro while Stripe
 * retries the card; anything else that isn't paying is Free.
 */
export function planFor(status: unknown): Plan {
  return status === 'active' || status === 'trialing' || status === 'past_due' ? 'pro' : 'free';
}

export const billingRoutes = new Hono();

// A Stripe refusal (bad key, archived price) reaches the tutor as a message to
// show, and the operator's log gets the detail.
billingRoutes.onError((error, c) => {
  console.error('[billing]', error);
  return c.json({ error: 'Billing is unavailable right now' }, 502);
});

billingRoutes.use('/checkout', requireTutor);
billingRoutes.use('/portal', requireTutor);
billingRoutes.use('*', async (c, next) =>
  env.stripeSecretKey ? next() : c.json({ error: 'Billing is not set up on this server' }, 404),
);

billingRoutes.post('/checkout', async (c) => {
  const tutor = currentTutor(c);
  let customer = tutor.stripeCustomerId;
  if (!customer) {
    const created = await stripe('customers', {
      email: tutor.email,
      name: tutor.name,
      'metadata[tutorId]': tutor.id,
    });
    customer = String(created.id);
    await db.update(tutors).set({ stripeCustomerId: customer }).where(eq(tutors.id, tutor.id));
  }
  const session = await stripe('checkout/sessions', {
    mode: 'subscription',
    customer,
    client_reference_id: tutor.id,
    'line_items[0][price]': env.stripePriceId,
    'line_items[0][quantity]': '1',
    allow_promotion_codes: 'true',
    success_url: `${env.publicUrl}/?billing=done`,
    cancel_url: `${env.publicUrl}/`,
  });
  return c.json({ url: session.url });
});

billingRoutes.post('/portal', async (c) => {
  const customer = currentTutor(c).stripeCustomerId;
  if (!customer) return c.json({ error: 'No subscription yet' }, 400);
  const session = await stripe('billing_portal/sessions', {
    customer,
    return_url: `${env.publicUrl}/`,
  });
  return c.json({ url: session.url });
});

/**
 * Stripe's events, from its servers. The plan follows the subscription's
 * status; the customer id ties it to the tutor who checked out.
 */
billingRoutes.post('/webhook', async (c) => {
  const payload = await c.req.text();
  if (!verifyStripeSignature(payload, c.req.header('stripe-signature'), env.stripeWebhookSecret)) {
    return c.json({ error: 'bad signature' }, 400);
  }
  const event = JSON.parse(payload) as { type?: string; data?: { object?: Record<string, unknown> } };
  const object = event.data?.object ?? {};
  const customer = typeof object.customer === 'string' ? object.customer : undefined;
  if (event.type === 'checkout.session.completed' && customer) {
    const tutorId = object.client_reference_id;
    if (typeof tutorId === 'string') {
      await db
        .update(tutors)
        .set({ stripeCustomerId: customer, ...(object.status === 'complete' ? { plan: 'pro' } : {}) })
        .where(eq(tutors.id, tutorId));
    }
  } else if (event.type?.startsWith('customer.subscription.') && customer) {
    const plan = event.type === 'customer.subscription.deleted' ? 'free' : planFor(object.status);
    await db.update(tutors).set({ plan }).where(eq(tutors.stripeCustomerId, customer));
  }
  return c.json({ received: true });
});
