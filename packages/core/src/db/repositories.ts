import {
  ActionSchema,
  OverlayConfigSchema,
  ProfileSchema,
  makeId,
  type Action,
  type ActionInput,
  type GiftInfo,
  type OverlayConfig,
  type Profile,
} from '@toktok/shared';
import type { Db } from './database';

/** Encryption backend (Electron safeStorage in the app, a fake in tests). */
export interface SecretCipher {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(cipher: Buffer): string;
}

export class SettingsRepo {
  constructor(private readonly db: Db) {}

  get<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, JSON.stringify(value));
  }

  all(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
  }
}

export class SecretsRepo {
  constructor(
    private readonly db: Db,
    private readonly cipher: SecretCipher,
  ) {}

  set(key: string, value: string): void {
    if (!this.cipher.isAvailable()) {
      throw new Error('Stockage sécurisé indisponible sur ce système (trousseau du système inaccessible)');
    }
    this.db
      .prepare(
        'INSERT INTO secrets (key, cipher) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET cipher = excluded.cipher',
      )
      .run(key, this.cipher.encrypt(value));
  }

  get(key: string): string | null {
    const row = this.db.prepare('SELECT cipher FROM secrets WHERE key = ?').get(key) as
      { cipher: Buffer } | undefined;
    if (!row) return null;
    return this.cipher.decrypt(row.cipher);
  }

  has(key: string): boolean {
    return this.db.prepare('SELECT 1 FROM secrets WHERE key = ?').get(key) !== undefined;
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM secrets WHERE key = ?').run(key);
  }

  deletePrefix(prefix: string): void {
    this.db.prepare("DELETE FROM secrets WHERE key LIKE ? ESCAPE '\\'").run(escapeLike(prefix) + '%');
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

interface ProfileRow {
  id: string;
  name: string;
  game: string;
  is_active: number;
}

export class ProfilesRepo {
  constructor(private readonly db: Db) {}

  list(): Profile[] {
    const rows = this.db.prepare('SELECT * FROM profiles ORDER BY created_at').all() as ProfileRow[];
    return rows.map(toProfile);
  }

  get(id: string): Profile | null {
    const row = this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as ProfileRow | undefined;
    return row ? toProfile(row) : null;
  }

  getActive(): Profile | null {
    const row = this.db.prepare('SELECT * FROM profiles WHERE is_active = 1 LIMIT 1').get() as
      ProfileRow | undefined;
    return row ? toProfile(row) : null;
  }

  create(input: { name: string; game?: string }): Profile {
    const now = Date.now();
    const profile = ProfileSchema.parse({ id: makeId('prf'), name: input.name, game: input.game ?? '' });
    this.db
      .prepare(
        'INSERT INTO profiles (id, name, game, is_active, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
      )
      .run(profile.id, profile.name, profile.game, now, now);
    if (!this.getActive()) this.setActive(profile.id);
    return this.get(profile.id)!;
  }

  update(id: string, patch: { name?: string; game?: string }): Profile {
    const current = this.get(id);
    if (!current) throw new Error(`Unknown profile ${id}`);
    const next = ProfileSchema.parse({ ...current, ...patch });
    this.db
      .prepare('UPDATE profiles SET name = ?, game = ?, updated_at = ? WHERE id = ?')
      .run(next.name, next.game, Date.now(), id);
    return this.get(id)!;
  }

  setActive(id: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE profiles SET is_active = 0').run();
      const res = this.db.prepare('UPDATE profiles SET is_active = 1 WHERE id = ?').run(id);
      if (res.changes === 0) throw new Error(`Unknown profile ${id}`);
    });
    tx();
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
    if (!this.getActive()) {
      const first = this.list()[0];
      if (first) this.setActive(first.id);
    }
  }
}

function toProfile(row: ProfileRow): Profile {
  return { id: row.id, name: row.name, game: row.game, isActive: row.is_active === 1 };
}

interface ActionRow {
  id: string;
  profile_id: string;
  name: string;
  enabled: number;
  position: number;
  trigger_json: string;
  effects_json: string;
  cooldown_ms: number;
  user_cooldown_ms: number;
  priority: number;
  busy_policy: string;
  quantity_mode: string;
  max_multiplier: number;
  user_filter_json: string;
  sound_id: string | null;
  tts_template: string | null;
}

export class ActionsRepo {
  constructor(private readonly db: Db) {}

  listByProfile(profileId: string): Action[] {
    const rows = this.db
      .prepare('SELECT * FROM actions WHERE profile_id = ? ORDER BY position, created_at')
      .all(profileId) as ActionRow[];
    return rows.map(toAction);
  }

  get(id: string): Action | null {
    const row = this.db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as ActionRow | undefined;
    return row ? toAction(row) : null;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM actions').get() as { n: number }).n;
  }

  /** Insert or update (validated). */
  save(input: Omit<ActionInput, 'id'> & { id?: string }): Action {
    const action = ActionSchema.parse({ ...input, id: input.id ?? makeId('act') });
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO actions (id, profile_id, name, enabled, position, trigger_json, effects_json, cooldown_ms,
           user_cooldown_ms, priority, busy_policy, quantity_mode, max_multiplier, user_filter_json, sound_id,
           tts_template, created_at, updated_at)
         VALUES (@id, @profileId, @name, @enabled, @position, @trigger, @effects, @cooldownMs, @userCooldownMs,
           @priority, @busyPolicy, @quantityMode, @maxMultiplier, @userFilter, @soundId, @ttsTemplate, @now, @now)
         ON CONFLICT(id) DO UPDATE SET
           profile_id = excluded.profile_id, name = excluded.name, enabled = excluded.enabled,
           position = excluded.position, trigger_json = excluded.trigger_json,
           effects_json = excluded.effects_json, cooldown_ms = excluded.cooldown_ms,
           user_cooldown_ms = excluded.user_cooldown_ms, priority = excluded.priority,
           busy_policy = excluded.busy_policy, quantity_mode = excluded.quantity_mode,
           max_multiplier = excluded.max_multiplier, user_filter_json = excluded.user_filter_json,
           sound_id = excluded.sound_id, tts_template = excluded.tts_template, updated_at = excluded.updated_at`,
      )
      .run({
        id: action.id,
        profileId: action.profileId,
        name: action.name,
        enabled: action.enabled ? 1 : 0,
        position: action.position,
        trigger: JSON.stringify(action.trigger),
        effects: JSON.stringify(action.effects),
        cooldownMs: action.cooldownMs,
        userCooldownMs: action.userCooldownMs,
        priority: action.priority,
        busyPolicy: action.busyPolicy,
        quantityMode: action.quantityMode,
        maxMultiplier: action.maxMultiplier,
        userFilter: JSON.stringify(action.userFilter),
        soundId: action.soundId,
        ttsTemplate: action.ttsTemplate,
        now,
      });
    return this.get(action.id)!;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM actions WHERE id = ?').run(id);
  }
}

function toAction(row: ActionRow): Action {
  return ActionSchema.parse({
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    enabled: row.enabled === 1,
    position: row.position,
    trigger: JSON.parse(row.trigger_json),
    effects: JSON.parse(row.effects_json),
    cooldownMs: row.cooldown_ms,
    userCooldownMs: row.user_cooldown_ms,
    priority: row.priority,
    busyPolicy: row.busy_policy,
    quantityMode: row.quantity_mode,
    maxMultiplier: row.max_multiplier,
    userFilter: JSON.parse(row.user_filter_json),
    soundId: row.sound_id,
    ttsTemplate: row.tts_template,
  });
}

export interface IntegrationRecord {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export class IntegrationsRepo {
  constructor(private readonly db: Db) {}

  list(): IntegrationRecord[] {
    const rows = this.db.prepare('SELECT * FROM integrations ORDER BY name').all() as {
      id: string;
      kind: string;
      name: string;
      enabled: number;
      config_json: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      enabled: r.enabled === 1,
      config: JSON.parse(r.config_json) as Record<string, unknown>,
    }));
  }

  get(id: string): IntegrationRecord | null {
    return this.list().find((i) => i.id === id) ?? null;
  }

  save(rec: Omit<IntegrationRecord, 'id'> & { id?: string }): IntegrationRecord {
    const id = rec.id ?? makeId('int');
    this.db
      .prepare(
        `INSERT INTO integrations (id, kind, name, enabled, config_json) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, enabled = excluded.enabled,
           config_json = excluded.config_json`,
      )
      .run(id, rec.kind, rec.name, rec.enabled ? 1 : 0, JSON.stringify(rec.config));
    return this.get(id)!;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM integrations WHERE id = ?').run(id);
  }
}

export class GiftCatalogRepo {
  constructor(private readonly db: Db) {}

  upsertMany(platform: string, gifts: GiftInfo[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO gift_catalog (platform, gift_id, name, diamonds, image_url, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(platform, gift_id) DO UPDATE SET name = excluded.name, diamonds = excluded.diamonds,
         image_url = COALESCE(excluded.image_url, gift_catalog.image_url), updated_at = excluded.updated_at`,
    );
    const now = Date.now();
    const tx = this.db.transaction((list: GiftInfo[]) => {
      for (const g of list) stmt.run(platform, g.id, g.name, g.diamonds, g.imageUrl ?? null, now);
    });
    tx(gifts);
  }

  list(platform: string): GiftInfo[] {
    const rows = this.db
      .prepare('SELECT * FROM gift_catalog WHERE platform = ? ORDER BY diamonds, name')
      .all(platform) as { gift_id: string; name: string; diamonds: number; image_url: string | null }[];
    return rows.map((r) => ({
      id: r.gift_id,
      name: r.name,
      diamonds: r.diamonds,
      ...(r.image_url ? { imageUrl: r.image_url } : {}),
    }));
  }

  lastUpdated(platform: string): number | null {
    const row = this.db
      .prepare('SELECT MAX(updated_at) AS t FROM gift_catalog WHERE platform = ?')
      .get(platform) as { t: number | null };
    return row.t;
  }
}

export class OverlaysRepo {
  constructor(private readonly db: Db) {}

  list(): (OverlayConfig & { token: string })[] {
    const rows = this.db.prepare('SELECT * FROM overlays ORDER BY name').all() as {
      id: string;
      kind: string;
      name: string;
      style_json: string;
      options_json: string;
      token: string;
    }[];
    return rows.map((r) => ({
      ...OverlayConfigSchema.parse({
        id: r.id,
        kind: r.kind,
        name: r.name,
        style: JSON.parse(r.style_json),
        options: JSON.parse(r.options_json),
      }),
      token: r.token,
    }));
  }

  get(id: string): (OverlayConfig & { token: string }) | null {
    return this.list().find((o) => o.id === id) ?? null;
  }

  save(
    input: Omit<OverlayConfig, 'id'> & { id?: string },
    newToken: () => string,
  ): OverlayConfig & { token: string } {
    const cfg = OverlayConfigSchema.parse({ ...input, id: input.id ?? makeId('ovl') });
    const existing = this.get(cfg.id);
    this.db
      .prepare(
        `INSERT INTO overlays (id, kind, name, style_json, options_json, token) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, style_json = excluded.style_json,
           options_json = excluded.options_json`,
      )
      .run(
        cfg.id,
        cfg.kind,
        cfg.name,
        JSON.stringify(cfg.style),
        JSON.stringify(cfg.options),
        existing?.token ?? newToken(),
      );
    return this.get(cfg.id)!;
  }

  regenerateToken(id: string, token: string): void {
    this.db.prepare('UPDATE overlays SET token = ? WHERE id = ?').run(token, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM overlays WHERE id = ?').run(id);
  }
}

export class EventLogRepo {
  constructor(private readonly db: Db) {}

  append(sessionId: string | null, kind: string, payload: unknown, ts = Date.now()): void {
    this.db
      .prepare('INSERT INTO event_log (session_id, ts, kind, payload_json) VALUES (?, ?, ?, ?)')
      .run(sessionId, ts, kind, JSON.stringify(payload));
  }

  recent(limit = 200): { ts: number; kind: string; payload: unknown }[] {
    const rows = this.db
      .prepare('SELECT ts, kind, payload_json FROM event_log ORDER BY id DESC LIMIT ?')
      .all(limit) as { ts: number; kind: string; payload_json: string }[];
    return rows.map((r) => ({ ts: r.ts, kind: r.kind, payload: JSON.parse(r.payload_json) as unknown }));
  }

  /** Keeps the log bounded: removes entries older than maxAgeMs and beyond maxRows. */
  prune(maxAgeMs: number, maxRows: number, now = Date.now()): void {
    this.db.prepare('DELETE FROM event_log WHERE ts < ?').run(now - maxAgeMs);
    this.db
      .prepare(
        'DELETE FROM event_log WHERE id <= (SELECT id FROM event_log ORDER BY id DESC LIMIT 1 OFFSET ?)',
      )
      .run(maxRows);
  }
}

export class SessionsRepo {
  constructor(private readonly db: Db) {}

  start(platform: string, channel: string): string {
    const id = makeId('ses');
    this.db
      .prepare('INSERT INTO live_sessions (id, platform, channel, started_at) VALUES (?, ?, ?, ?)')
      .run(id, platform, channel, Date.now());
    return id;
  }

  end(id: string): void {
    this.db
      .prepare('UPDATE live_sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL')
      .run(Date.now(), id);
  }

  addViewerStats(
    sessionId: string,
    user: { id: string; username: string; displayName: string; avatarUrl?: string | undefined },
    delta: { diamonds?: number; gifts?: number; likes?: number },
  ): void {
    this.db
      .prepare(
        `INSERT INTO viewer_stats (session_id, user_id, username, display_name, avatar_url, diamonds, gifts, likes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, user_id) DO UPDATE SET
           username = excluded.username, display_name = excluded.display_name,
           avatar_url = COALESCE(excluded.avatar_url, viewer_stats.avatar_url),
           diamonds = viewer_stats.diamonds + excluded.diamonds,
           gifts = viewer_stats.gifts + excluded.gifts,
           likes = viewer_stats.likes + excluded.likes`,
      )
      .run(
        sessionId,
        user.id,
        user.username,
        user.displayName,
        user.avatarUrl ?? null,
        delta.diamonds ?? 0,
        delta.gifts ?? 0,
        delta.likes ?? 0,
      );
  }

  topDonors(sessionId: string, limit: number) {
    const rows = this.db
      .prepare(
        `SELECT user_id, username, display_name, avatar_url, diamonds FROM viewer_stats
         WHERE session_id = ? AND diamonds > 0 ORDER BY diamonds DESC, username LIMIT ?`,
      )
      .all(sessionId, limit) as {
      user_id: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
      diamonds: number;
    }[];
    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name,
      ...(r.avatar_url ? { avatarUrl: r.avatar_url } : {}),
      diamonds: r.diamonds,
    }));
  }
}

export interface SoundRecord {
  id: string;
  name: string;
  filePath: string;
  volume: number;
}

export class SoundsRepo {
  constructor(private readonly db: Db) {}

  list(): SoundRecord[] {
    const rows = this.db.prepare('SELECT * FROM sounds ORDER BY name').all() as {
      id: string;
      name: string;
      file_path: string;
      volume: number;
    }[];
    return rows.map((r) => ({ id: r.id, name: r.name, filePath: r.file_path, volume: r.volume }));
  }

  get(id: string): SoundRecord | null {
    return this.list().find((s) => s.id === id) ?? null;
  }

  add(name: string, filePath: string, id = makeId('snd')): SoundRecord {
    this.db
      .prepare('INSERT INTO sounds (id, name, file_path, volume) VALUES (?, ?, ?, 1)')
      .run(id, name, filePath);
    return this.get(id)!;
  }

  update(id: string, patch: { name?: string; volume?: number }): void {
    const cur = this.get(id);
    if (!cur) throw new Error('Son introuvable');
    const volume = Math.min(1, Math.max(0, patch.volume ?? cur.volume));
    this.db
      .prepare('UPDATE sounds SET name = ?, volume = ? WHERE id = ?')
      .run(patch.name ?? cur.name, volume, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM sounds WHERE id = ?').run(id);
  }
}

export interface Repositories {
  settings: SettingsRepo;
  secrets: SecretsRepo;
  profiles: ProfilesRepo;
  actions: ActionsRepo;
  integrations: IntegrationsRepo;
  gifts: GiftCatalogRepo;
  overlays: OverlaysRepo;
  eventLog: EventLogRepo;
  sessions: SessionsRepo;
  sounds: SoundsRepo;
}

export function createRepositories(db: Db, cipher: SecretCipher): Repositories {
  return {
    settings: new SettingsRepo(db),
    secrets: new SecretsRepo(db, cipher),
    profiles: new ProfilesRepo(db),
    actions: new ActionsRepo(db),
    integrations: new IntegrationsRepo(db),
    gifts: new GiftCatalogRepo(db),
    overlays: new OverlaysRepo(db),
    eventLog: new EventLogRepo(db),
    sessions: new SessionsRepo(db),
    sounds: new SoundsRepo(db),
  };
}
