import type { KeyObject } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Billing, Interval } from './billing.js';
import { subscriptionUpdate } from './billing.js';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  hashToken,
  newToken,
  publicKeyPem,
  signLicense,
  verifyPassword,
  type LicensePayload,
} from './crypto.js';
import { RateLimiter } from './rate-limit.js';
import { effectivePlan, type DeviceRow, type Store, type UserRow } from './store.js';
import { page } from './pages.js';

export interface AppDeps {
  store: Store;
  privateKey: KeyObject;
  billing: Billing | null;
  publicUrl: string;
  adminToken?: string;
  maxDevices: number;
  licenseTtlDays: number;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
  now?: () => Date;
  /** Auth requests allowed per IP and minute (default 20). */
  authPerMinute?: number;
  /** owner/repo hosting the releases (default: the project repository). */
  githubRepo?: string;
  fetchJson?: (url: string) => Promise<unknown>;
}

interface GithubRelease {
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name?: string; browser_download_url?: string }[];
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'toktok-site' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: 'Adresse email invalide' }));
const Password = z.string().min(8, 'Mot de passe : 8 caractères minimum').max(200);
const DeviceFields = {
  deviceId: z.string().regex(/^[\w-]{8,100}$/),
  deviceName: z.string().trim().min(1).max(80),
};
const RegisterBody = z.object({ email: Email, password: Password, ...DeviceFields });
const WebCredentials = z.object({ email: Email, password: z.string().min(1).max(200) });

const SESSION_COOKIE = 'tt_session';
const WEB_SESSION_DAYS = 7;
/** The web space (static files next to src/ and dist/). */
const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
const LoginBody = z.object({
  email: Email,
  password: z.string().min(1).max(200),
  ...DeviceFields,
  /** Device (id from the device_limit error) to sign out to make room for this one. */
  replaceDevice: z.uuid().optional(),
});

type Authed = { user: UserRow; device: DeviceRow };

export function createApp(deps: AppDeps): express.Express {
  const { store, billing } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const authByIp = new RateLimiter(deps.authPerMinute ?? 20, 60_000);
  const failuresByEmail = new RateLimiter(8, 15 * 60_000);

  const app = express();
  app.disable('x-powered-by');
  // Railway puts exactly one proxy in front of the service.
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (_req.path.startsWith('/v1/') || _req.path.startsWith('/admin/'))
      res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // ------------------------------------------------------------ helpers

  const issueLicense = (user: UserRow, device: DeviceRow): string => {
    const t = Math.floor(now().getTime() / 1000);
    const { plan, until } = effectivePlan(user, now());
    const payload: LicensePayload = {
      v: 1,
      sub: user.id,
      email: user.email,
      plan,
      did: device.device_id,
      iat: t,
      exp: t + deps.licenseTtlDays * 86_400,
      ...(until ? { until: Math.floor(until.getTime() / 1000) } : {}),
    };
    return signLicense(payload, deps.privateKey);
  };

  const account = async (user: UserRow, current?: DeviceRow) => {
    const { plan, until } = effectivePlan(user, now());
    const devices = await store.devices(user.id);
    return {
      email: user.email,
      plan,
      planUntil: until?.toISOString() ?? null,
      proGranted: user.pro_granted,
      subscription: user.subscription_id
        ? {
            status: user.subscription_status,
            currentPeriodEnd: user.current_period_end?.toISOString() ?? null,
            cancelAtPeriodEnd: user.cancel_at_period_end,
          }
        : null,
      billing: { enabled: Boolean(billing), intervals: billing?.intervals() ?? [] },
      maxDevices: deps.maxDevices,
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        lastSeenAt: d.last_seen_at.toISOString(),
        current: d.id === current?.id,
      })),
    };
  };

  const session = async (user: UserRow, deviceId: string, deviceName: string) => {
    const token = newToken();
    const device = await store.upsertDevice(user.id, deviceId, deviceName, hashToken(token));
    return { deviceToken: token, license: issueLicense(user, device), account: await account(user, device) };
  };

  const auth = async (req: Request): Promise<Authed> => {
    const m = /^Bearer ([\w-]{20,100})$/.exec(req.get('authorization') ?? '');
    const found = m ? await store.deviceByToken(hashToken(m[1]!)) : null;
    if (!found) throw new HttpError(401, 'unauthorized', 'Session expirée, reconnecte-toi');
    return found;
  };

  const secureCookies = deps.publicUrl.startsWith('https://');
  const siteOrigin = new URL(deps.publicUrl).origin;

  const setSessionCookie = (res: Response, token: string, maxAgeSec: number) => {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAgeSec}${secureCookies ? '; Secure' : ''}`,
    );
  };

  const startWebSession = async (res: Response, user: UserRow) => {
    const token = newToken();
    await store.createWebSession(
      user.id,
      hashToken(token),
      new Date(now().getTime() + WEB_SESSION_DAYS * 86_400_000),
    );
    setSessionCookie(res, token, WEB_SESSION_DAYS * 86_400);
  };

  /** State-changing web requests must come from the site itself (CSRF), on top of SameSite=Strict. */
  const sameOrigin = (req: Request) => {
    if (req.get('origin') !== siteOrigin) throw new HttpError(403, 'forbidden', 'Origine refusée');
  };

  const webAuth = async (req: Request): Promise<UserRow> => {
    const token = readCookie(req, SESSION_COOKIE);
    const user = token && /^[\w-]{20,100}$/.test(token) ? await store.webSessionUser(hashToken(token)) : null;
    if (!user) throw new HttpError(401, 'unauthorized', 'Connecte-toi');
    return user;
  };

  const checkout = async (user: UserRow, body: unknown) => {
    if (!billing) throw new HttpError(503, 'billing_disabled', 'Le paiement n’est pas encore ouvert');
    const { interval } = parse(z.object({ interval: z.enum(['monthly', 'yearly']) }), body);
    if (!billing.intervals().includes(interval)) throw new HttpError(400, 'invalid', 'Formule indisponible');
    if (effectivePlan(user, now()).plan === 'pro' && user.subscription_id) {
      throw new HttpError(409, 'already_pro', 'Tu es déjà abonné : gère ton abonnement depuis le portail');
    }
    const url = await billing.createCheckout({
      userId: user.id,
      email: user.email,
      customerId: user.stripe_customer_id,
      interval: interval as Interval,
      successUrl: `${deps.publicUrl}/billing/success`,
      cancelUrl: `${deps.publicUrl}/billing/cancel`,
    });
    return { url };
  };

  const portal = async (user: UserRow) => {
    if (!billing) throw new HttpError(503, 'billing_disabled', 'Le paiement n’est pas encore ouvert');
    if (!user.stripe_customer_id)
      throw new HttpError(404, 'no_customer', 'Aucun abonnement associé à ce compte');
    return { url: await billing.createPortal(user.stripe_customer_id, `${deps.publicUrl}/billing/return`) };
  };

  /** Password check shared by the app and the web space (lockout checked first). */
  const checkCredentials = async (email: string, password: string): Promise<UserRow> => {
    if (failuresByEmail.blocked(email)) {
      throw new HttpError(429, 'rate_limited', 'Trop d’essais pour ce compte, réessaie dans 15 minutes');
    }
    const user = await store.userByEmail(email);
    const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!user || !ok) {
      failuresByEmail.hit(email);
      throw new HttpError(401, 'bad_credentials', 'Email ou mot de passe incorrect');
    }
    failuresByEmail.reset(email);
    return user;
  };

  const limitIp = (req: Request) => {
    if (!authByIp.hit(req.ip ?? '?'))
      throw new HttpError(429, 'rate_limited', 'Trop de tentatives, patiente une minute');
  };

  const route =
    (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) =>
      fn(req, res).then((body) => {
        if (body !== undefined && !res.headersSent) res.json(body);
      }, next);

  const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
    const r = schema.safeParse(body);
    if (!r.success) throw new HttpError(400, 'invalid', r.error.issues[0]?.message ?? 'Requête invalide');
    return r.data;
  };

  // ------------------------------------------------------------ Stripe webhook (raw body, before json parser)

  app.post(
    '/stripe/webhook',
    express.raw({ type: 'application/json', limit: '1mb' }),
    route(async (req) => {
      if (!billing) throw new HttpError(503, 'billing_disabled', 'Paiement non configuré');
      let event;
      try {
        event = billing.parseEvent(req.body as Buffer, req.get('stripe-signature') ?? '');
      } catch {
        throw new HttpError(400, 'bad_signature', 'Signature Stripe invalide');
      }
      if (!(await store.markEvent(event.id, event.type))) return { received: true, duplicate: true };
      try {
        await handleStripeEvent(event);
      } catch (err) {
        // Let Stripe retry: forget the event so the retry is processed.
        await store.forgetEvent(event.id);
        throw err;
      }
      return { received: true };
    }),
  );

  const handleStripeEvent = async (event: ReturnType<Billing['parseEvent']>) => {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        const userId = s.client_reference_id;
        const subId = typeof s.subscription === 'string' ? s.subscription : s.subscription?.id;
        if (!userId || !subId || !billing) return;
        const user = await store.applySubscription(await billing.subscription(subId), userId);
        log('info', `Abonnement activé pour ${user?.email ?? userId}`);
        return;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const update = subscriptionUpdate(event.data.object);
        const metaUser = event.data.object.metadata?.userId;
        const user =
          (await store.applySubscription(update)) ??
          (metaUser ? await store.applySubscription(update, metaUser) : null);
        if (!user) log('warn', `Abonnement ${update.subscriptionId} : client ${update.customerId} inconnu`);
        return;
      }
      default:
        return;
    }
  };

  app.use(express.json({ limit: '16kb' }));

  // ------------------------------------------------------------ public

  app.get('/health', (_req, res) => {
    res.json({ ok: true, billing: Boolean(billing) });
  });

  // Public key the app embeds to verify licenses offline (never the private key).
  const publicKey = publicKeyPem(deps.privateKey);
  app.get('/v1/public-key', (_req, res) => {
    res.type('text/plain').send(publicKey);
  });

  app.get('/billing/success', (_req, res) => {
    res
      .type('html')
      .send(
        page(
          'Paiement validé ✅',
          'Merci ! Retourne dans TokTok Game Connector Live : ton compte passe en Pro dans quelques secondes (bouton « Actualiser » sur la page Compte).',
        ),
      );
  });
  app.get('/billing/cancel', (_req, res) => {
    res
      .type('html')
      .send(page('Paiement annulé', 'Aucun paiement n’a été effectué. Tu peux fermer cette page.'));
  });
  app.get('/billing/return', (_req, res) => {
    res.type('html').send(page('C’est noté', 'Tu peux fermer cette page et retourner dans l’application.'));
  });

  // ------------------------------------------------------------ auth

  app.post(
    '/v1/auth/register',
    route(async (req, res) => {
      limitIp(req);
      const body = parse(RegisterBody, req.body);
      const user = await store.createUser(body.email, await hashPassword(body.password));
      if (!user) throw new HttpError(409, 'email_taken', 'Un compte existe déjà avec cet email');
      log('info', `Nouveau compte ${user.email}`);
      res.status(201);
      return session(user, body.deviceId, body.deviceName);
    }),
  );

  app.post(
    '/v1/auth/login',
    route(async (req) => {
      limitIp(req);
      const body = parse(LoginBody, req.body);
      const user = await checkCredentials(body.email, body.password);
      const devices = await store.devices(user.id);
      if (body.replaceDevice) await store.deleteDevice(user.id, body.replaceDevice);
      const known = devices.some((d) => d.device_id === body.deviceId);
      const active = devices.filter((d) => d.id !== body.replaceDevice).length;
      if (!known && active >= deps.maxDevices) {
        throw new HttpError(409, 'device_limit', `Limite de ${deps.maxDevices} appareils atteinte`, {
          devices: devices.map((d) => ({ id: d.id, name: d.name, lastSeenAt: d.last_seen_at.toISOString() })),
        });
      }
      return session(user, body.deviceId, body.deviceName);
    }),
  );

  app.post(
    '/v1/auth/logout',
    route(async (req) => {
      const { user, device } = await auth(req);
      await store.deleteDevice(user.id, device.id);
      return { ok: true };
    }),
  );

  app.post(
    '/v1/auth/password',
    route(async (req) => {
      const { user, device } = await auth(req);
      const body = parse(z.object({ oldPassword: z.string().max(200), newPassword: Password }), req.body);
      if (!(await verifyPassword(body.oldPassword, user.password_hash))) {
        throw new HttpError(401, 'bad_credentials', 'Mot de passe actuel incorrect');
      }
      await store.setPassword(user.id, await hashPassword(body.newPassword));
      // Other devices and browsers must sign in again with the new password.
      await store.deleteOtherDevices(user.id, device.id);
      await store.deleteWebSessions(user.id);
      return { ok: true };
    }),
  );

  // ------------------------------------------------------------ license & account

  app.post(
    '/v1/license',
    route(async (req) => {
      const { user, device } = await auth(req);
      return { license: issueLicense(user, device), account: await account(user, device) };
    }),
  );

  app.get(
    '/v1/account',
    route(async (req) => {
      const { user, device } = await auth(req);
      return account(user, device);
    }),
  );

  app.delete(
    '/v1/devices/:id',
    route(async (req) => {
      const { user } = await auth(req);
      const id = parse(z.uuid(), req.params.id);
      if (!(await store.deleteDevice(user.id, id)))
        throw new HttpError(404, 'not_found', 'Appareil introuvable');
      return { ok: true };
    }),
  );

  app.delete(
    '/v1/account',
    route(async (req) => {
      const { user } = await auth(req);
      const body = parse(z.object({ password: z.string().max(200) }), req.body);
      if (!(await verifyPassword(body.password, user.password_hash))) {
        throw new HttpError(401, 'bad_credentials', 'Mot de passe incorrect');
      }
      if (billing && user.subscription_id && user.subscription_status !== 'canceled') {
        await billing.cancelNow(user.subscription_id);
      }
      await store.deleteUser(user.id);
      log('info', `Compte supprimé ${user.email}`);
      return { ok: true };
    }),
  );

  // ------------------------------------------------------------ billing

  app.post(
    '/v1/billing/checkout',
    route(async (req) => checkout((await auth(req)).user, req.body)),
  );

  app.post(
    '/v1/billing/portal',
    route(async (req) => portal((await auth(req)).user)),
  );

  // ------------------------------------------------------------ web space (cookie session)

  app.post(
    '/v1/web/register',
    route(async (req, res) => {
      sameOrigin(req);
      limitIp(req);
      const body = parse(z.object({ email: Email, password: Password }), req.body);
      const user = await store.createUser(body.email, await hashPassword(body.password));
      if (!user) throw new HttpError(409, 'email_taken', 'Un compte existe déjà avec cet email');
      log('info', `Nouveau compte (web) ${user.email}`);
      await startWebSession(res, user);
      res.status(201);
      return account(user);
    }),
  );

  app.post(
    '/v1/web/login',
    route(async (req, res) => {
      sameOrigin(req);
      limitIp(req);
      const body = parse(WebCredentials, req.body);
      const user = await checkCredentials(body.email, body.password);
      await startWebSession(res, user);
      return account(user);
    }),
  );

  app.post(
    '/v1/web/logout',
    route(async (req, res) => {
      sameOrigin(req);
      const token = readCookie(req, SESSION_COOKIE);
      if (token) await store.deleteWebSession(hashToken(token));
      setSessionCookie(res, '', 0);
      return { ok: true };
    }),
  );

  app.get(
    '/v1/web/me',
    route(async (req) => {
      return account(await webAuth(req));
    }),
  );

  app.post(
    '/v1/web/checkout',
    route(async (req) => {
      sameOrigin(req);
      return checkout(await webAuth(req), req.body);
    }),
  );

  app.post(
    '/v1/web/portal',
    route(async (req) => {
      sameOrigin(req);
      return portal(await webAuth(req));
    }),
  );

  app.delete(
    '/v1/web/devices/:id',
    route(async (req) => {
      sameOrigin(req);
      const user = await webAuth(req);
      const id = parse(z.uuid(), req.params.id);
      if (!(await store.deleteDevice(user.id, id)))
        throw new HttpError(404, 'not_found', 'Appareil introuvable');
      return account(user);
    }),
  );

  // ------------------------------------------------------------ admin

  const admin = (req: Request) => {
    const given = Buffer.from(/^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1] ?? '');
    const expected = Buffer.from(deps.adminToken ?? '');
    if (!deps.adminToken || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new HttpError(401, 'unauthorized', 'Jeton admin invalide');
    }
  };

  app.post(
    '/admin/grant',
    route(async (req) => {
      admin(req);
      const body = parse(
        z.object({ email: Email, pro: z.boolean(), until: z.iso.datetime().nullable().default(null) }),
        req.body,
      );
      const user = await store.grantPro(body.email, body.until ? new Date(body.until) : null, body.pro);
      if (!user) throw new HttpError(404, 'not_found', 'Compte introuvable');
      log('info', `Admin : Pro ${body.pro ? 'accordé' : 'retiré'} pour ${user.email}`);
      return { email: user.email, ...effectivePlan(user, now()) };
    }),
  );

  app.post(
    '/admin/reset-password',
    route(async (req) => {
      admin(req);
      const { email } = parse(z.object({ email: Email }), req.body);
      const user = await store.userByEmail(email);
      if (!user) throw new HttpError(404, 'not_found', 'Compte introuvable');
      const temporary = newToken().slice(0, 16);
      await store.setPassword(user.id, await hashPassword(temporary));
      await store.deleteOtherDevices(user.id, '00000000-0000-0000-0000-000000000000');
      await store.deleteWebSessions(user.id);
      log('info', `Admin : mot de passe réinitialisé pour ${user.email}`);
      return { email: user.email, temporaryPassword: temporary };
    }),
  );

  // ------------------------------------------------------------ download (latest installer)

  const releasesPage = `https://github.com/${deps.githubRepo ?? 'dexsdev329-afk/toktok-connector'}/releases`;
  let latestExe: { url: string; at: number } | null = null;
  /** Redirects to the installer of the latest GitHub release (looked up at most every 5 minutes). */
  app.get('/telecharger/windows', (_req, res, next) => {
    const send = (url: string) => res.redirect(302, url);
    if (latestExe && now().getTime() - latestExe.at < 300_000) return send(latestExe.url);
    (deps.fetchJson ?? defaultFetchJson)(
      `https://api.github.com/repos/${deps.githubRepo ?? 'dexsdev329-afk/toktok-connector'}/releases?per_page=10`,
    )
      .then((list) => {
        // Newest published release that really contains an installer.
        const exe = (Array.isArray(list) ? (list as GithubRelease[]) : [])
          .filter((r) => !r.draft && !r.prerelease)
          .flatMap((r) => r.assets ?? [])
          .find(
            (a) => /\.exe$/i.test(a.name ?? '') && a.browser_download_url?.startsWith('https://github.com/'),
          );
        if (!exe?.browser_download_url) return send(releasesPage);
        latestExe = { url: exe.browser_download_url, at: now().getTime() };
        send(exe.browser_download_url);
      })
      .catch((err: unknown) => {
        log('warn', `Téléchargement : ${String(err)}`);
        if (latestExe) return send(latestExe.url);
        send(releasesPage);
      })
      .catch(next);
  });

  // ------------------------------------------------------------ web space (static)

  app.use((req, res, next) => {
    if (req.path.startsWith('/v1/') || req.path.startsWith('/admin/')) return next();
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
        "connect-src 'self' https://api.github.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: '10m' }));

  // ------------------------------------------------------------ errors

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found', message: 'Introuvable' });
  });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
      return;
    }
    const e = err as { type?: string; status?: number };
    if (e?.type === 'entity.parse.failed' || e?.type === 'entity.too.large') {
      res.status(400).json({ error: 'invalid', message: 'Requête invalide' });
      return;
    }
    log('error', err instanceof Error ? (err.stack ?? err.message) : String(err));
    res.status(500).json({ error: 'server_error', message: 'Erreur serveur, réessaie plus tard' });
  });

  return app;
}
