import {
  createHash,
  createPrivateKey,
  randomBytes,
  scrypt,
  sign,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto';

// ---------------------------------------------------------------- passwords

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password.normalize('NFKC'),
      salt,
      SCRYPT.keylen,
      { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
}

/** "scrypt$N$r$p$salt$hash" (base64url), so parameters can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), key.toString('base64url')].join(
    '$',
  );
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password.normalize('NFKC'),
      Buffer.from(salt, 'base64url'),
      expected.length,
      { N: Number(n), r: Number(r), p: Number(p) },
      (err, k) => (err ? reject(err) : resolve(k)),
    ),
  );
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Hash used when the email is unknown, so login time does not reveal which emails exist. */
export const DUMMY_PASSWORD_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

// ---------------------------------------------------------------- device tokens

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------- licenses

/**
 * License token: base64url(JSON payload) + "." + base64url(Ed25519 signature of the first part).
 * The app verifies it offline with the embedded public key (packages/core/src/license).
 */
export interface LicensePayload {
  v: 1;
  /** User id. */
  sub: string;
  email: string;
  plan: 'free' | 'pro';
  /** Device id the license was issued to. */
  did: string;
  /** Issued at / expires at (seconds). */
  iat: number;
  exp: number;
  /** End of the paid period, when known (seconds). */
  until?: number;
}

export function loadPrivateKey(pem: string): KeyObject {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('LICENSE_PRIVATE_KEY doit être une clé Ed25519');
  return key;
}

export function signLicense(payload: LicensePayload, key: KeyObject): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(null, Buffer.from(body), key).toString('base64url');
  return `${body}.${signature}`;
}
