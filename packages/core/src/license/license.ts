import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';

/** Payload signed by apps/license-server (keep both sides in sync; see the interop test). */
export const LicensePayloadSchema = z.object({
  v: z.literal(1),
  sub: z.string().min(1),
  email: z.string(),
  plan: z.enum(['free', 'pro']),
  did: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
  until: z.number().int().optional(),
});
export type LicensePayload = z.infer<typeof LicensePayloadSchema>;

export type LicenseCheck =
  | { ok: true; payload: LicensePayload }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' | 'device' };

const keyCache = new Map<string, KeyObject>();

/**
 * Verifies a license token offline: Ed25519 signature, payload shape, expiry and device binding.
 * A license copied to another PC (other device id) is rejected.
 */
export function checkLicense(
  token: string,
  publicKeyPem: string,
  deviceId: string,
  now = Date.now(),
): LicenseCheck {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1] || token.length > 4096)
    return { ok: false, reason: 'malformed' };
  let key = keyCache.get(publicKeyPem);
  if (!key) {
    key = createPublicKey(publicKeyPem);
    keyCache.set(publicKeyPem, key);
  }
  let valid: boolean;
  try {
    valid = verify(null, Buffer.from(parts[0]), key, Buffer.from(parts[1], 'base64url'));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'signature' };
  let payload: LicensePayload;
  try {
    payload = LicensePayloadSchema.parse(JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.did !== deviceId) return { ok: false, reason: 'device' };
  if (payload.exp * 1000 <= now) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}
