import { z } from 'zod';

/** Accepts a PEM key as-is, or base64-encoded (handy for one-line environment variables). */
const pem = z
  .string()
  .min(1)
  .transform((v) =>
    v.includes('-----BEGIN') ? v.replace(/\\n/g, '\n') : Buffer.from(v, 'base64').toString('utf8'),
  );

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().default(8080),
  DATABASE_URL: z.string().min(1),
  /** Ed25519 private key (PKCS#8 PEM). Optional: generated and stored in the database when absent. */
  LICENSE_PRIVATE_KEY: pem.optional(),
  /** Public URL of this server (Stripe redirects, pages). */
  PUBLIC_URL: z.string().url().default('http://localhost:8080'),
  ADMIN_TOKEN: z.string().min(24).optional(),
  MAX_DEVICES: z.coerce.number().int().min(1).max(20).default(3),
  /** A license stays valid offline this long; the app refreshes it every day. */
  LICENSE_TTL_DAYS: z.coerce.number().int().min(1).max(60).default(7),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_MONTHLY: z.string().optional(),
  STRIPE_PRICE_YEARLY: z.string().optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuration invalide : ${fields}`);
  }
  return parsed.data;
}
