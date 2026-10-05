import {
  FREE_ENTITLEMENTS,
  PRO_ENTITLEMENTS,
  entitlementsFor,
  type Entitlements,
  type EntitlementsProvider,
} from '@toktok/shared';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { LICENSE_PUBLIC_KEY, checkLicense, type SecretsRepo, type SettingsRepo } from '@toktok/core';
import type { AccountState, AccountSummary, LoginResult } from '../shared/api';

/** Production accounts server (apps/license-server on Railway). */
export const DEFAULT_ACCOUNT_SERVER = 'https://license-server-production.up.railway.app';

const KEYS = {
  deviceId: 'account.deviceId',
  license: 'account.license',
  summary: 'account.summary',
  email: 'account.email',
} as const;
const SECRET_TOKEN = 'account.deviceToken';
const REFRESH_EVERY_MS = 12 * 3_600_000;

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface AccountOptions {
  settings: SettingsRepo;
  secrets: SecretsRepo;
  /** Called whenever the account or the plan changes. */
  onChange: (state: AccountState) => void;
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
  fetch?: typeof fetch;
  publicKey?: string;
  /** Development only: everything unlocked without an account. */
  devPro?: boolean;
  serverUrl?: string;
  now?: () => number;
}

/**
 * The user's account: device session (token stored encrypted), the signed license (checked
 * offline at every use) and the Pro subscription. Implements the entitlements provider.
 */
export class AccountService implements EntitlementsProvider {
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshing: Promise<void> | null = null;
  private lastError: string | null = null;
  private lastPlan: string | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly opts: AccountOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  // ------------------------------------------------------------ entitlements

  current(): Entitlements {
    if (this.opts.devPro) return PRO_ENTITLEMENTS;
    const check = this.check();
    return check?.ok ? entitlementsFor(check.payload.plan) : FREE_ENTITLEMENTS;
  }

  private check() {
    const token = this.opts.settings.get<string>(KEYS.license, '');
    if (!token) return null;
    return checkLicense(token, this.opts.publicKey ?? LICENSE_PUBLIC_KEY, this.deviceId(), this.now());
  }

  // ------------------------------------------------------------ state

  state(): AccountState {
    const check = this.check();
    const summary = this.opts.settings.get<AccountSummary | null>(KEYS.summary, null);
    const loggedIn = this.opts.secrets.has(SECRET_TOKEN);
    return {
      loggedIn,
      email: this.opts.settings.get<string>(KEYS.email, '') || null,
      plan: this.current().plan,
      devPro: Boolean(this.opts.devPro),
      license: !check
        ? { status: 'none' }
        : check.ok
          ? {
              status: 'valid',
              expiresAt: check.payload.exp * 1000,
              ...(check.payload.until ? { until: check.payload.until * 1000 } : {}),
            }
          : { status: check.reason === 'expired' ? 'expired' : 'invalid' },
      summary: loggedIn ? summary : null,
      lastError: this.lastError,
      serverUrl: this.serverUrl(),
    };
  }

  start(): void {
    if (this.opts.secrets.has(SECRET_TOKEN)) void this.refresh().catch(() => undefined);
    // Refresh the license regularly, and notice an expiry while offline.
    this.timer = setInterval(() => {
      if (this.opts.secrets.has(SECRET_TOKEN)) void this.refresh().catch(() => undefined);
      else this.emit();
    }, REFRESH_EVERY_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ------------------------------------------------------------ session

  register(email: string, password: string): Promise<LoginResult> {
    return this.signIn('/v1/auth/register', { email, password });
  }

  login(email: string, password: string, replaceDevice?: string): Promise<LoginResult> {
    return this.signIn('/v1/auth/login', { email, password, ...(replaceDevice ? { replaceDevice } : {}) });
  }

  private async signIn(path: string, body: Record<string, unknown>): Promise<LoginResult> {
    try {
      const res = await this.request<{ deviceToken: string; license: string; account: AccountSummary }>(
        'POST',
        path,
        { ...body, deviceId: this.deviceId(), deviceName: deviceName() },
        false,
      );
      this.opts.secrets.set(SECRET_TOKEN, res.deviceToken);
      this.opts.settings.set(KEYS.email, res.account.email);
      this.store(res.license, res.account);
      return { ok: true };
    } catch (err) {
      if (err instanceof AccountError && err.code === 'device_limit') {
        return {
          ok: false,
          error: 'device_limit',
          message: err.message,
          devices: (err.body.devices ?? []) as { id: string; name: string; lastSeenAt: string }[],
        };
      }
      throw err;
    }
  }

  async logout(): Promise<void> {
    await this.request('POST', '/v1/auth/logout', undefined).catch(() => undefined);
    this.clear();
  }

  /** Renews the license; a revoked session logs out, a network error keeps the cached license. */
  refresh(): Promise<void> {
    this.refreshing ??= (async () => {
      try {
        const res = await this.request<{ license: string; account: AccountSummary }>('POST', '/v1/license');
        this.lastError = null;
        this.store(res.license, res.account);
      } catch (err) {
        if (err instanceof AccountError && err.status === 401) {
          this.opts.log('warn', 'Compte : session expirée, reconnexion nécessaire');
          this.clear();
          return;
        }
        this.lastError = err instanceof Error ? err.message : String(err);
        this.emit();
        throw err;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  // ------------------------------------------------------------ account management

  async checkoutUrl(interval: 'monthly' | 'yearly'): Promise<string> {
    const { url } = await this.request<{ url: string }>('POST', '/v1/billing/checkout', { interval });
    return checkUrl(url, ['checkout.stripe.com']);
  }

  /** After opening Stripe Checkout: refresh every 10 s for 10 minutes until the plan turns Pro. */
  watchUpgrade(durationMs = 600_000, everyMs = 10_000): void {
    const end = this.now() + durationMs;
    const tick = () => {
      if (this.current().plan === 'pro' || this.now() > end || !this.opts.secrets.has(SECRET_TOKEN)) return;
      void this.refresh()
        .catch(() => undefined)
        .finally(() => setTimeout(tick, everyMs));
    };
    setTimeout(tick, everyMs);
  }

  async portalUrl(): Promise<string> {
    const { url } = await this.request<{ url: string }>('POST', '/v1/billing/portal');
    return checkUrl(url, ['billing.stripe.com']);
  }

  async removeDevice(id: string): Promise<void> {
    await this.request('DELETE', `/v1/devices/${encodeURIComponent(id)}`);
    await this.refresh();
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await this.request('POST', '/v1/auth/password', { oldPassword, newPassword });
    await this.refresh();
  }

  async deleteAccount(password: string): Promise<void> {
    await this.request('DELETE', '/v1/account', { password });
    this.clear();
  }

  // ------------------------------------------------------------ internals

  deviceId(): string {
    let id = this.opts.settings.get<string>(KEYS.deviceId, '');
    if (!id) {
      id = `dev-${randomBytes(16).toString('hex')}`;
      this.opts.settings.set(KEYS.deviceId, id);
    }
    return id;
  }

  private serverUrl(): string {
    return (this.opts.serverUrl || DEFAULT_ACCOUNT_SERVER).replace(/\/$/, '');
  }

  private store(license: string, summary: AccountSummary): void {
    this.opts.settings.set(KEYS.license, license);
    this.opts.settings.set(KEYS.summary, summary);
    const check = this.check();
    if (check && !check.ok) this.opts.log('warn', `Licence refusée (${check.reason})`);
    this.emit();
  }

  private clear(): void {
    this.opts.secrets.delete(SECRET_TOKEN);
    this.opts.settings.set(KEYS.license, '');
    this.opts.settings.set(KEYS.summary, null);
    this.lastError = null;
    this.emit();
  }

  private emit(): void {
    const state = this.state();
    if (state.plan !== this.lastPlan) {
      if (this.lastPlan !== null) this.opts.log('info', `Plan : ${state.plan === 'pro' ? 'Pro' : 'gratuit'}`);
      this.lastPlan = state.plan;
    }
    this.opts.onChange(state);
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    authed = true,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (authed) {
      const token = this.opts.secrets.get(SECRET_TOKEN);
      if (!token) throw new AccountError('Non connecté', 401, 'unauthorized');
      headers.authorization = `Bearer ${token}`;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(this.serverUrl() + path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new AccountError('Serveur de comptes injoignable (connexion Internet ?)', 0, 'network');
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const message = typeof json.message === 'string' ? json.message : `Erreur ${res.status}`;
      throw new AccountError(
        message,
        res.status,
        typeof json.error === 'string' ? json.error : 'error',
        json,
      );
    }
    return json as T;
  }
}

function deviceName(): string {
  return (hostname() || 'PC').slice(0, 80);
}

/** Only Stripe pages are ever opened in the browser. */
function checkUrl(url: string, hosts: string[]): string {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !hosts.includes(u.hostname)) throw new Error('URL de paiement inattendue');
  return u.toString();
}
