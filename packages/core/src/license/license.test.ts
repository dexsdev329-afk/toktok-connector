import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// Interop: tokens signed by the real server code must verify in the app.
import { signLicense } from '../../../../apps/license-server/src/crypto';
import {
  FREE_ENTITLEMENTS,
  PRO_ENTITLEMENTS,
  entitlementsFor,
  integrationAllowed,
  overlayAllowed,
} from '@toktok/shared';
import { checkLicense } from './license';
import { LICENSE_PUBLIC_KEY } from './public-key';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const now = 1_800_000_000_000;
const payload = {
  v: 1 as const,
  sub: 'u1',
  email: 'a@b.fr',
  plan: 'pro' as const,
  did: 'device-0001',
  iat: now / 1000 - 10,
  exp: now / 1000 + 3600,
};

describe('license tokens', () => {
  it('accepts a token signed by the server for this device', () => {
    const token = signLicense(payload, privateKey);
    expect(checkLicense(token, pub, 'device-0001', now)).toEqual({ ok: true, payload });
  });

  it('rejects other devices, expired, tampered and foreign tokens', () => {
    const token = signLicense(payload, privateKey);
    expect(checkLicense(token, pub, 'device-0002', now)).toEqual({ ok: false, reason: 'device' });
    expect(checkLicense(token, pub, 'device-0001', now + 3601_000)).toEqual({ ok: false, reason: 'expired' });
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, plan: 'pro', exp: payload.exp + 1e6 })).toString(
      'base64url',
    );
    expect(checkLicense(`${forged}.${sig}`, pub, 'device-0001', now).ok).toBe(false);
    expect(checkLicense(`${body}.${sig}`, LICENSE_PUBLIC_KEY, 'device-0001', now)).toEqual({
      ok: false,
      reason: 'signature',
    });
    expect(checkLicense('garbage', pub, 'device-0001', now)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('maps plans to features', () => {
    expect(entitlementsFor('pro')).toBe(PRO_ENTITLEMENTS);
    expect(entitlementsFor('free')).toBe(FREE_ENTITLEMENTS);
    expect(overlayAllowed(FREE_ENTITLEMENTS, 'alerts')).toBe(true);
    expect(overlayAllowed(FREE_ENTITLEMENTS, 'wheel')).toBe(false);
    expect(integrationAllowed(FREE_ENTITLEMENTS, 'minecraft-rcon')).toBe(true);
    expect(integrationAllowed(FREE_ENTITLEMENTS, 'chaos-mod')).toBe(false);
    expect(integrationAllowed(PRO_ENTITLEMENTS, 'chaos-mod')).toBe(true);
  });
});
