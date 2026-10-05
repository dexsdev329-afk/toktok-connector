import { generateKeyPairSync, verify } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { Billing } from './billing.js';
import { subscriptionUpdate } from './billing.js';
import type { LicensePayload } from './crypto.js';
import { migrate } from './db.js';
import { Store } from './store.js';

// Test helper type: response bodies are read loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const WEBHOOK_SECRET = 'whsec_test_secret';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');

/** Stripe objects as the API returns them (trimmed). */
const subscription = (status: string, end: number, cancel = false) =>
  ({
    id: 'sub_123',
    object: 'subscription',
    customer: 'cus_123',
    status,
    cancel_at_period_end: cancel,
    metadata: {},
    items: { object: 'list', data: [{ id: 'si_1', current_period_end: end }] },
  }) as unknown as Stripe.Subscription;

class FakeBilling implements Billing {
  checkouts: unknown[] = [];
  canceled: string[] = [];
  sub = subscription('active', Math.floor(Date.now() / 1000) + 30 * 86400);
  intervals() {
    return ['monthly', 'yearly'] as const as never;
  }
  async createCheckout(opts: unknown) {
    this.checkouts.push(opts);
    return 'https://checkout.stripe.com/c/pay/test';
  }
  async createPortal(customerId: string) {
    return `https://billing.stripe.com/p/session/${customerId}`;
  }
  parseEvent(raw: Buffer, signature: string) {
    return Stripe.webhooks.constructEvent(raw, signature, WEBHOOK_SECRET);
  }
  async subscription() {
    return subscriptionUpdate(this.sub);
  }
  async cancelNow(id: string) {
    this.canceled.push(id);
  }
}

let base = '';
let close: () => void;
const billing = new FakeBilling();

beforeAll(async () => {
  const db = new PGlite();
  await migrate(db);
  await migrate(db); // idempotent
  const app = createApp({
    store: new Store(db),
    privateKey,
    billing,
    publicUrl: 'https://licenses.example',
    adminToken: 'admin-token-admin-token-123',
    maxDevices: 2,
    licenseTtlDays: 7,
    authPerMinute: 1000,
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
}, 30_000);
afterAll(() => close());

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Json };
}

function decode(license: string): LicensePayload {
  const [body, sig] = license.split('.');
  expect(verify(null, Buffer.from(body!), publicKey, Buffer.from(sig!, 'base64url'))).toBe(true);
  return JSON.parse(Buffer.from(body!, 'base64url').toString()) as LicensePayload;
}

async function webhook(event: object) {
  const payload = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await fetch(`${base}/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: payload,
  });
  return { status: res.status, body: (await res.json()) as Json };
}

const device = (n: number) => ({ deviceId: `device-000${n}`, deviceName: `PC ${n}` });
let token = '';
let lastTemp = '';
async function adminReset(): Promise<{ temporaryPassword: string }> {
  const r = await fetch(`${base}/admin/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer admin-token-admin-token-123' },
    body: JSON.stringify({ email: 'enzo@example.com' }),
  });
  const body = (await r.json()) as { temporaryPassword: string };
  lastTemp = body.temporaryPassword;
  return body;
}

describe('license server', () => {
  it('registers an account and returns a signed free license', async () => {
    const r = await call('POST', '/v1/auth/register', {
      email: ' Enzo@Example.com ',
      password: 'motdepasse',
      ...device(1),
    });
    expect(r.status).toBe(201);
    token = r.body.deviceToken;
    const lic = decode(r.body.license);
    expect(lic).toMatchObject({ v: 1, email: 'enzo@example.com', plan: 'free', did: 'device-0001' });
    expect(lic.exp - lic.iat).toBe(7 * 86400);
    expect(r.body.account.devices).toHaveLength(1);
    expect(
      (
        await call('POST', '/v1/auth/register', {
          email: 'enzo@example.com',
          password: 'xxxxxxxx',
          ...device(2),
        })
      ).body.error,
    ).toBe('email_taken');
    expect(
      (await call('POST', '/v1/auth/register', { email: 'bad', password: 'x', ...device(2) })).status,
    ).toBe(400);
  });

  it('logs in, enforces the device limit and lets a device be replaced', async () => {
    expect(
      (await call('POST', '/v1/auth/login', { email: 'enzo@example.com', password: 'wrong', ...device(2) }))
        .status,
    ).toBe(401);
    const second = await call('POST', '/v1/auth/login', {
      email: 'enzo@example.com',
      password: 'motdepasse',
      ...device(2),
    });
    expect(second.status).toBe(200);
    const third = await call('POST', '/v1/auth/login', {
      email: 'enzo@example.com',
      password: 'motdepasse',
      ...device(3),
    });
    expect(third.status).toBe(409);
    expect(third.body.devices).toHaveLength(2);
    const victim = third.body.devices.find((d: { name: string }) => d.name === 'PC 2').id;
    const replaced = await call('POST', '/v1/auth/login', {
      email: 'enzo@example.com',
      password: 'motdepasse',
      ...device(3),
      replaceDevice: victim,
    });
    expect(replaced.status).toBe(200);
    // The replaced device's token no longer works.
    expect((await call('POST', '/v1/license', undefined, second.body.deviceToken)).status).toBe(401);
    // Same device logging in again does not count twice.
    expect(
      (
        await call('POST', '/v1/auth/login', {
          email: 'enzo@example.com',
          password: 'motdepasse',
          ...device(1),
        })
      ).status,
    ).toBe(200);
  });

  it('refreshes licenses with the device token only', async () => {
    const login = await call('POST', '/v1/auth/login', {
      email: 'enzo@example.com',
      password: 'motdepasse',
      ...device(1),
    });
    token = login.body.deviceToken;
    expect((await call('POST', '/v1/license', undefined, 'not-a-valid-token-at-all-x')).status).toBe(401);
    const r = await call('POST', '/v1/license', undefined, token);
    expect(decode(r.body.license).plan).toBe('free');
  });

  it('upgrades to Pro through Stripe Checkout + webhooks, then back to free', async () => {
    const co = await call('POST', '/v1/billing/checkout', { interval: 'yearly' }, token);
    expect(co.body.url).toContain('checkout.stripe.com');
    const userId = decode((await call('POST', '/v1/license', undefined, token)).body.license).sub;
    expect(billing.checkouts.at(-1)).toMatchObject({
      userId,
      email: 'enzo@example.com',
      interval: 'yearly',
      customerId: null,
    });

    // Unsigned / tampered deliveries are rejected.
    const bad = await fetch(`${base}/stripe/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=00' },
      body: '{}',
    });
    expect(bad.status).toBe(400);

    const completed = {
      id: 'evt_1',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          object: 'checkout.session',
          client_reference_id: userId,
          customer: 'cus_123',
          subscription: 'sub_123',
        },
      },
    };
    expect((await webhook(completed)).status).toBe(200);
    expect((await webhook(completed)).body.duplicate).toBe(true);
    let lic = decode((await call('POST', '/v1/license', undefined, token)).body.license);
    expect(lic.plan).toBe('pro');
    expect(lic.until).toBeGreaterThan(lic.iat);
    expect((await call('POST', '/v1/billing/checkout', { interval: 'monthly' }, token)).body.error).toBe(
      'already_pro',
    );
    expect((await call('POST', '/v1/billing/portal', undefined, token)).body.url).toContain('cus_123');

    // Cancellation at period end keeps Pro; deletion ends it.
    const end = Math.floor(Date.now() / 1000) + 10 * 86400;
    await webhook({
      id: 'evt_2',
      object: 'event',
      type: 'customer.subscription.updated',
      data: { object: subscription('active', end, true) },
    });
    const acc = await call('GET', '/v1/account', undefined, token);
    expect(acc.body).toMatchObject({ plan: 'pro', subscription: { cancelAtPeriodEnd: true } });
    await webhook({
      id: 'evt_3',
      object: 'event',
      type: 'customer.subscription.deleted',
      data: { object: subscription('canceled', end) },
    });
    lic = decode((await call('POST', '/v1/license', undefined, token)).body.license);
    expect(lic.plan).toBe('free');
  });

  it('lets an admin grant Pro and reset a password', async () => {
    expect((await call('POST', '/admin/grant', { email: 'enzo@example.com', pro: true })).status).toBe(401);
    const h = (body: unknown, path: string) =>
      fetch(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer admin-token-admin-token-123' },
        body: JSON.stringify(body),
      }).then(async (r) => ({ status: r.status, body: (await r.json()) as Json }));
    expect((await h({ email: 'enzo@example.com', pro: true }, '/admin/grant')).body.plan).toBe('pro');
    expect(decode((await call('POST', '/v1/license', undefined, token)).body.license).plan).toBe('pro');
    const past = new Date(Date.now() - 1000).toISOString();
    expect((await h({ email: 'enzo@example.com', pro: true, until: past }, '/admin/grant')).body.plan).toBe(
      'free',
    );
    const reset = await h({ email: 'enzo@example.com' }, '/admin/reset-password');
    expect(reset.body.temporaryPassword).toHaveLength(16);
    // Every device was signed out.
    expect((await call('POST', '/v1/license', undefined, token)).status).toBe(401);
    const login = await call('POST', '/v1/auth/login', {
      email: 'enzo@example.com',
      password: reset.body.temporaryPassword,
      ...device(1),
    });
    expect(login.status).toBe(200);
    token = login.body.deviceToken;
  });

  it('changes the password and deletes the account (GDPR)', async () => {
    const other = await call('POST', '/v1/auth/login', {
      email: 'enzo@example.com',
      password: (await adminReset()).temporaryPassword,
      ...device(2),
    });
    const mine = await call('POST', '/v1/auth/login', {
      email: 'enzo@example.com',
      password: lastTemp,
      ...device(1),
    });
    token = mine.body.deviceToken;
    expect(other.status).toBe(200);
    expect(
      (await call('POST', '/v1/auth/password', { oldPassword: 'nope', newPassword: 'nouveau-mdp' }, token))
        .status,
    ).toBe(401);
    expect(
      (await call('POST', '/v1/auth/password', { oldPassword: lastTemp, newPassword: 'nouveau-mdp' }, token))
        .status,
    ).toBe(200);
    // Other devices are signed out, this one stays.
    expect((await call('POST', '/v1/license', undefined, other.body.deviceToken)).status).toBe(401);
    expect((await call('POST', '/v1/license', undefined, token)).status).toBe(200);

    expect((await call('DELETE', '/v1/account', { password: 'nope' }, token)).status).toBe(401);
    expect((await call('DELETE', '/v1/account', { password: 'nouveau-mdp' }, token)).status).toBe(200);
    // The (canceled) subscription is not canceled twice; the account is gone.
    expect(billing.canceled).toEqual([]);
    expect((await call('POST', '/v1/license', undefined, token)).status).toBe(401);
    expect(
      (
        await call('POST', '/v1/auth/login', {
          email: 'enzo@example.com',
          password: 'nouveau-mdp',
          ...device(1),
        })
      ).status,
    ).toBe(401);
  });

  it('locks an account after repeated failures, even for the right password', async () => {
    await call('POST', '/v1/auth/register', {
      email: 'lock@example.com',
      password: 'bonmotdepasse',
      ...device(5),
    });
    for (let i = 0; i < 8; i++) {
      await call('POST', '/v1/auth/login', {
        email: 'lock@example.com',
        password: `faux-${i}`,
        ...device(5),
      });
    }
    const r = await call('POST', '/v1/auth/login', {
      email: 'lock@example.com',
      password: 'bonmotdepasse',
      ...device(5),
    });
    expect(r.status).toBe(429);
  });

  it('answers health checks and unknown routes', async () => {
    expect((await call('GET', '/health')).body).toEqual({ ok: true, billing: true });
    expect((await call('GET', '/nope')).status).toBe(404);
    const html = await fetch(`${base}/billing/success`);
    expect(html.headers.get('content-type')).toContain('text/html');
  });
});
