import type { Queryable } from './db.js';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
  stripe_customer_id: string | null;
  subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  pro_granted: boolean;
  pro_granted_until: Date | null;
}

export interface DeviceRow {
  id: string;
  user_id: string;
  device_id: string;
  name: string;
  created_at: Date;
  last_seen_at: Date;
}

/** Subscription statuses that keep Pro (past_due: Stripe is still retrying the payment). */
const PAYING = new Set(['active', 'trialing', 'past_due']);

export function effectivePlan(u: UserRow, now = new Date()): { plan: 'free' | 'pro'; until?: Date } {
  if (u.pro_granted && (!u.pro_granted_until || u.pro_granted_until > now)) {
    return u.pro_granted_until ? { plan: 'pro', until: u.pro_granted_until } : { plan: 'pro' };
  }
  if (u.subscription_status && PAYING.has(u.subscription_status) && u.current_period_end) {
    // One day of tolerance around renewals (the webhook may arrive a bit late).
    if (u.current_period_end.getTime() + 86_400_000 > now.getTime()) {
      return { plan: 'pro', until: u.current_period_end };
    }
  }
  return { plan: 'free' };
}

export interface SubscriptionUpdate {
  customerId: string;
  subscriptionId: string;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export class Store {
  constructor(private readonly db: Queryable) {}

  async createUser(email: string, passwordHash: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING *`,
      [email, passwordHash],
    );
    return rows[0] ?? null;
  }

  async userByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
    return rows[0] ?? null;
  }

  async userById(id: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  async userByCustomer(customerId: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>('SELECT * FROM users WHERE stripe_customer_id = $1', [
      customerId,
    ]);
    return rows[0] ?? null;
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    await this.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
  }

  async setCustomer(userId: string, customerId: string): Promise<void> {
    await this.db.query('UPDATE users SET stripe_customer_id = $2 WHERE id = $1', [userId, customerId]);
  }

  /** Applies a Stripe subscription state to the user owning the customer (or `userId`). */
  async applySubscription(s: SubscriptionUpdate, userId?: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `UPDATE users SET stripe_customer_id = $1, subscription_id = $2, subscription_status = $3,
              current_period_end = $4, cancel_at_period_end = $5
        WHERE ${userId ? 'id = $6' : 'stripe_customer_id = $1'}
        RETURNING *`,
      [
        s.customerId,
        s.subscriptionId,
        s.status,
        s.currentPeriodEnd,
        s.cancelAtPeriodEnd,
        ...(userId ? [userId] : []),
      ],
    );
    return rows[0] ?? null;
  }

  async grantPro(email: string, until: Date | null, granted: boolean): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      'UPDATE users SET pro_granted = $2, pro_granted_until = $3 WHERE email = $1 RETURNING *',
      [email, granted, until],
    );
    return rows[0] ?? null;
  }

  async deleteUser(userId: string): Promise<void> {
    await this.db.query('DELETE FROM users WHERE id = $1', [userId]);
  }

  // ------------------------------------------------------------ devices

  async devices(userId: string): Promise<DeviceRow[]> {
    const { rows } = await this.db.query<DeviceRow>(
      'SELECT id, user_id, device_id, name, created_at, last_seen_at FROM devices WHERE user_id = $1 ORDER BY last_seen_at DESC',
      [userId],
    );
    return rows;
  }

  /** Registers (or re-registers) a device with a new token hash. */
  async upsertDevice(userId: string, deviceId: string, name: string, tokenHash: string): Promise<DeviceRow> {
    const { rows } = await this.db.query<DeviceRow>(
      `INSERT INTO devices (user_id, device_id, name, token_hash) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, device_id) DO UPDATE
         SET name = excluded.name, token_hash = excluded.token_hash, last_seen_at = now()
       RETURNING id, user_id, device_id, name, created_at, last_seen_at`,
      [userId, deviceId, name, tokenHash],
    );
    return rows[0]!;
  }

  async deviceByToken(tokenHash: string): Promise<{ device: DeviceRow; user: UserRow } | null> {
    const { rows } = await this.db.query<DeviceRow & { u: UserRow }>(
      `UPDATE devices d SET last_seen_at = now() FROM users u
        WHERE d.token_hash = $1 AND u.id = d.user_id
        RETURNING d.id, d.user_id, d.device_id, d.name, d.created_at, d.last_seen_at, row_to_json(u.*) AS u`,
      [tokenHash],
    );
    const r = rows[0];
    if (!r) return null;
    const { u, ...device } = r;
    return { device, user: reviveUser(u) };
  }

  async deleteDevice(userId: string, id: string): Promise<boolean> {
    const { rows } = await this.db.query('DELETE FROM devices WHERE user_id = $1 AND id = $2 RETURNING id', [
      userId,
      id,
    ]);
    return rows.length > 0;
  }

  async deleteOtherDevices(userId: string, keepId: string): Promise<void> {
    await this.db.query('DELETE FROM devices WHERE user_id = $1 AND id <> $2', [userId, keepId]);
  }

  // ------------------------------------------------------------ web sessions

  async createWebSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.db.query('DELETE FROM web_sessions WHERE expires_at < now()');
    await this.db.query('INSERT INTO web_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
      tokenHash,
      userId,
      expiresAt,
    ]);
  }

  async webSessionUser(tokenHash: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT u.* FROM web_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  async deleteWebSession(tokenHash: string): Promise<void> {
    await this.db.query('DELETE FROM web_sessions WHERE token_hash = $1', [tokenHash]);
  }

  async deleteWebSessions(userId: string): Promise<void> {
    await this.db.query('DELETE FROM web_sessions WHERE user_id = $1', [userId]);
  }

  // ------------------------------------------------------------ stripe events

  /** Returns false when the event was already processed (Stripe retries deliveries). */
  async markEvent(id: string, type: string): Promise<boolean> {
    const { rows } = await this.db.query(
      'INSERT INTO stripe_events (id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id',
      [id, type],
    );
    return rows.length > 0;
  }

  async forgetEvent(id: string): Promise<void> {
    await this.db.query('DELETE FROM stripe_events WHERE id = $1', [id]);
  }
}

/** row_to_json returns timestamps as strings. */
function reviveUser(u: UserRow): UserRow {
  const date = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));
  return {
    ...u,
    created_at: date(u.created_at)!,
    current_period_end: date(u.current_period_end),
    pro_granted_until: date(u.pro_granted_until),
  };
}
