import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import { createRepositories, openDatabase, type Repositories } from '@toktok/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// End to end against the real accounts server code (in-process PostgreSQL).
import { createApp } from '../../../license-server/src/app';
import { migrate } from '../../../license-server/src/db';
import { Store } from '../../../license-server/src/store';
import type { AccountState } from '../shared/api';
import { AccountService } from './account';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const ADMIN = 'admin-token-admin-token-123';
let base = '';
let close: () => void;

beforeAll(async () => {
  const db = new PGlite();
  await migrate(db);
  const app = createApp({
    store: new Store(db),
    privateKey,
    billing: null,
    publicUrl: 'https://x',
    adminToken: ADMIN,
    maxDevices: 1,
    licenseTtlDays: 7,
    authPerMinute: 1000,
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
}, 30_000);
afterAll(() => close());

const plainCipher = {
  isAvailable: () => true,
  encrypt: (s: string) => Buffer.from(s),
  decrypt: (b: Buffer) => b.toString(),
};

function client(
  repos: Repositories = createRepositories(openDatabase(':memory:'), plainCipher),
  now = Date.now,
) {
  const states: AccountState[] = [];
  const account = new AccountService({
    settings: repos.settings,
    secrets: repos.secrets,
    log: () => undefined,
    publicKey: PUBLIC_PEM,
    serverUrl: base,
    onChange: (s) => states.push(s),
    now,
  });
  return { account, states, repos };
}

const grant = (email: string, pro: boolean) =>
  fetch(`${base}/admin/grant`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN}` },
    body: JSON.stringify({ email, pro }),
  });

describe('AccountService ↔ license server', () => {
  it('starts on the free plan, registers, and follows plan changes', async () => {
    const { account, states } = client();
    expect(account.current().plan).toBe('free');
    expect(account.state()).toMatchObject({ loggedIn: false, license: { status: 'none' } });

    expect(await account.register('streamer@example.com', 'motdepasse')).toEqual({ ok: true });
    expect(account.state()).toMatchObject({
      loggedIn: true,
      email: 'streamer@example.com',
      plan: 'free',
      license: { status: 'valid' },
    });
    expect(account.current().maxActions).toBe(3);

    await grant('streamer@example.com', true);
    await account.refresh();
    expect(account.current().plan).toBe('pro');
    expect(states.at(-1)?.plan).toBe('pro');
    expect(account.state().summary?.devices).toHaveLength(1);
  });

  it('reports the device limit and can replace a device', async () => {
    const other = client();
    const r = await other.account.login('streamer@example.com', 'motdepasse');
    expect(r).toMatchObject({ ok: false, error: 'device_limit' });
    if (r.ok) return;
    expect(await other.account.login('streamer@example.com', 'motdepasse', r.devices[0]!.id)).toEqual({
      ok: true,
    });
    expect(other.account.current().plan).toBe('pro');
  });

  it('keeps Pro offline until the license expires, and logs out when the session is revoked', async () => {
    let now = Date.now();
    const c = client(undefined, () => now);
    await c.account.login('streamer@example.com', 'motdepasse').then(async (r) => {
      if (!r.ok) await c.account.login('streamer@example.com', 'motdepasse', r.devices[0]!.id);
    });
    expect(c.account.current().plan).toBe('pro');
    // A license copied to another PC is useless.
    const copied = client();
    copied.repos.settings.set('account.license', c.repos.settings.get('account.license', ''));
    expect(copied.account.current().plan).toBe('free');
    // 8 days without Internet: the license expired.
    now += 8 * 86_400_000;
    expect(c.account.state()).toMatchObject({ plan: 'free', license: { status: 'expired' } });
    now = Date.now();
    await c.account.logout();
    expect(c.account.state()).toMatchObject({ loggedIn: false, plan: 'free' });
  });

  it('surfaces server errors and network failures', async () => {
    const { account } = client();
    await expect(account.login('streamer@example.com', 'mauvais-mdp')).rejects.toThrow(
      'Email ou mot de passe incorrect',
    );
    const offline = new AccountService({
      settings: createRepositories(openDatabase(':memory:'), plainCipher).settings,
      secrets: createRepositories(openDatabase(':memory:'), plainCipher).secrets,
      log: () => undefined,
      publicKey: PUBLIC_PEM,
      serverUrl: 'http://127.0.0.1:9',
      onChange: () => undefined,
    });
    await expect(offline.register('a@b.fr', 'motdepasse')).rejects.toThrow('injoignable');
  });
});
