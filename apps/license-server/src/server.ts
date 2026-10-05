import pg from 'pg';
import { StripeBilling } from './billing.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { loadPrivateKey } from './crypto.js';
import { migrate } from './db.js';
import { Store } from './store.js';

function log(level: 'info' | 'warn' | 'error', message: string): void {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

const config = loadConfig();
const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  // Railway's private network needs no TLS; public URLs (sslmode=require) are honored by pg.
});
await migrate(pool);

const billing =
  config.STRIPE_SECRET_KEY && config.STRIPE_WEBHOOK_SECRET
    ? new StripeBilling(config.STRIPE_SECRET_KEY, config.STRIPE_WEBHOOK_SECRET, {
        ...(config.STRIPE_PRICE_MONTHLY ? { monthly: config.STRIPE_PRICE_MONTHLY } : {}),
        ...(config.STRIPE_PRICE_YEARLY ? { yearly: config.STRIPE_PRICE_YEARLY } : {}),
      })
    : null;
if (!billing)
  log('warn', 'Stripe non configuré : paiement désactivé (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET)');

const app = createApp({
  store: new Store(pool),
  privateKey: loadPrivateKey(config.LICENSE_PRIVATE_KEY),
  billing,
  publicUrl: config.PUBLIC_URL.replace(/\/$/, ''),
  ...(config.ADMIN_TOKEN ? { adminToken: config.ADMIN_TOKEN } : {}),
  maxDevices: config.MAX_DEVICES,
  licenseTtlDays: config.LICENSE_TTL_DAYS,
  log,
});

const server = app.listen(config.PORT, () => log('info', `Serveur de licences sur le port ${config.PORT}`));
const shutdown = () => {
  server.close(() => void pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
