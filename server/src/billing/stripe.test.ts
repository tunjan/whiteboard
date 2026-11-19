import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { planFor, verifyStripeSignature } from './stripe';

const secret = 'whsec_test';
const payload = '{"type":"customer.subscription.updated"}';
const sign = (t: number, body = payload, key = secret) =>
  `t=${t},v1=${createHmac('sha256', key).update(`${t}.${body}`).digest('hex')}`;

describe('verifyStripeSignature', () => {
  const now = 1_800_000_000;

  it('accepts what Stripe signed, within five minutes', () => {
    expect(verifyStripeSignature(payload, sign(now), secret, now)).toBe(true);
    expect(verifyStripeSignature(payload, sign(now - 299), secret, now)).toBe(true);
  });

  it('accepts a header carrying a rotated-out signature beside the good one', () => {
    const header = `${sign(now)},v1=${'0'.repeat(64)}`;
    expect(verifyStripeSignature(payload, header, secret, now)).toBe(true);
  });

  it('refuses a changed body, a wrong secret, a replay and a missing header', () => {
    expect(verifyStripeSignature(payload + ' ', sign(now), secret, now)).toBe(false);
    expect(verifyStripeSignature(payload, sign(now, payload, 'whsec_other'), secret, now)).toBe(false);
    expect(verifyStripeSignature(payload, sign(now - 301), secret, now)).toBe(false);
    expect(verifyStripeSignature(payload, undefined, secret, now)).toBe(false);
    expect(verifyStripeSignature(payload, sign(now), '', now)).toBe(false);
  });
});

describe('planFor', () => {
  it('keeps Pro while paying or retrying, Free otherwise', () => {
    expect(['active', 'trialing', 'past_due'].map(planFor)).toEqual(['pro', 'pro', 'pro']);
    expect(['canceled', 'unpaid', 'incomplete', undefined].map(planFor)).toEqual([
      'free',
      'free',
      'free',
      'free',
    ]);
  });
});
