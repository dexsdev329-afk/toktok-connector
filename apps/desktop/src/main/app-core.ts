import path from 'node:path';
import {
  ActionEngine,
  EventBus,
  GiftCatalog,
  GiftImageCache,
  LocalServer,
  OverlayFeeder,
  SIMULATOR_GIFTS,
  SessionTracker,
  SimulatorConnector,
  TikTokConnector,
  createRepositories,
  generateToken,
  openDatabase,
  simulatedUser,
  unlockedEntitlements,
  type Db,
  type IntegrationRecord,
  type Repositories,
  type SecretCipher,
} from '@toktok/core';
import { createTikTokClient } from '@toktok/core/tiktok-client';
import { IntegrationManager, type InputDriver } from '@toktok/integrations';
import {
  OverlayStyleSchema,
  contextFromEvent,
  makeId,
  type Action,
  type GiftInfo,
  type JournalEntry,
  type LiveEvent,
  type OverlayConfig,
  type OverlayKind,
} from '@toktok/shared';
import type {
  AppSettings,
  ConnectionInfo,
  IntegrationDto,
  IntegrationSaveInput,
  OverlayDto,
  OverlaySaveInput,
  SessionInfo,
  SettingsPatch,
  SimulatorUser,
} from '../shared/api';

export const SETTINGS = {
  language: 'app.language',
  tiktokUsername: 'tiktok.username',
  streakMode: 'gifts.streakMode',
  serverPort: 'server.port',
  engineConcurrency: 'engine.concurrency',
  engineMaxPerSecond: 'engine.maxPerSecond',
  apiToken: 'api.token',
  initialized: 'app.initialized',
} as const;
const SECRET_SIGN_KEY = 'tiktok.signApiKey';
const integrationSecretKey = (id: string, field: string) => `integration:${id}:${field}`;

export interface AppCoreOptions {
  dataDir: string;
  overlaysDir: string;
  cipher: SecretCipher;
  input: InputDriver | undefined;
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
  push: {
    connection(info: ConnectionInfo): void;
    session(info: SessionInfo): void;
    journal(entries: JournalEntry[]): void;
    integrations(): void;
  };
}

/** Event types that are too frequent to be kept in the persistent log. */
const NOT_PERSISTED = new Set<LiveEvent['type']>(['viewerCount', 'like']);

/**
 * Everything that runs in the main process, independent from Electron windows:
 * connectors -> bus -> (engine, stats, overlays, journal) -> integrations.
 */
export class AppCore {
  readonly db: Db;
  readonly repos: Repositories;
  readonly bus = new EventBus((err) => this.opts.log('error', `Listener: ${String(err)}`));
  readonly integrations: IntegrationManager;
  readonly engine: ActionEngine;
  readonly tracker: SessionTracker;
  readonly catalog: GiftCatalog;
  readonly images: GiftImageCache;
  readonly simulator: SimulatorConnector;
  readonly tiktok: TikTokConnector;
  readonly server: LocalServer;
  readonly feeder: OverlayFeeder;
  readonly entitlements = unlockedEntitlements;

  private journalBuffer: JournalEntry[] = [];
  private readonly journalRecent: JournalEntry[] = [];
  private journalTimer: ReturnType<typeof setInterval> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: AppCoreOptions) {
    this.db = openDatabase(path.join(opts.dataDir, 'toktok.sqlite'));
    this.repos = createRepositories(this.db, opts.cipher);
    this.seedDefaults();

    this.catalog = new GiftCatalog(this.repos.gifts, 'tiktok');
    this.images = new GiftImageCache(path.join(opts.dataDir, 'gift-images'));
    this.tracker = new SessionTracker(this.repos.sessions);

    this.integrations = new IntegrationManager({
      log: (level, message) => this.system(level, message),
      input: opts.input,
    });

    this.engine = new ActionEngine({
      runner: this.integrations,
      journal: (e) => this.bus.emit('journal', e),
      concurrency: this.settings().engineConcurrency,
      maxPerSecond: this.settings().engineMaxPerSecond,
    });

    const streakMode = this.settings().streakMode;
    this.simulator = new SimulatorConnector(() => this.giftsForSimulator(), streakMode);
    this.tiktok = new TikTokConnector({
      createClient: createTikTokClient,
      streakMode,
      lookupGift: (id) => this.catalog.get(id),
      onGiftSeen: (g) => {
        this.catalog.learn(g);
        void this.images.ensure(g);
      },
      ...this.signKeyOption(),
    });

    this.server = new LocalServer({
      port: this.settings().serverPort,
      overlaysDir: opts.overlaysDir,
      getOverlay: (id) => this.repos.overlays.get(id),
      initialMessages: (id) => this.feeder.initialMessages(id),
      apiToken: () => this.settings().apiToken,
      triggerAction: (id) => this.triggerActionById(id),
      giftImagePath: (id) => (this.images.has(id) ? this.images.filePath(id) : null),
    });
    this.feeder = new OverlayFeeder(
      () => this.repos.overlays.list(),
      this.tracker,
      (id, msg) => this.server.sendToOverlay(id, msg),
    );

    this.wire();
  }

  async start(): Promise<void> {
    await this.images.init();
    try {
      await this.server.start();
    } catch (err) {
      this.system(
        'error',
        `Serveur local indisponible sur le port ${this.settings().serverPort} : ${String(err)}`,
      );
    }
    for (const rec of this.repos.integrations.list()) {
      await this.integrations.upsert(this.withSecrets(rec)).catch((err: unknown) => {
        this.system('warn', `Intégration « ${rec.name} » : ${String(err)}`);
      });
    }
    this.reloadActions();
    this.journalTimer = setInterval(() => this.flushJournal(), 250);
    this.pruneTimer = setInterval(() => this.repos.eventLog.prune(7 * 86_400_000, 50_000), 3_600_000);
    void this.images.ensureMany(this.catalog.list());
  }

  async stop(): Promise<void> {
    if (this.journalTimer) clearInterval(this.journalTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.engine.dispose();
    this.feeder.dispose();
    await this.tiktok.disconnect().catch(() => undefined);
    await this.simulator.disconnect().catch(() => undefined);
    await this.integrations.disposeAll();
    await this.server.stop();
    this.db.close();
  }

  // ---------------------------------------------------------------- wiring

  private wire(): void {
    const onEvent = (e: LiveEvent) => this.bus.emit('live', this.withLocalImage(e));
    this.tiktok.on('event', onEvent);
    this.simulator.on('event', onEvent);
    this.tiktok.on('status', (s) => {
      this.opts.push.connection(s);
      if (s.status === 'connected') void this.refreshGiftsIfStale();
    });

    this.bus.on('live', (event) => {
      if (this.tracker.handle(event)) this.engine.resetSession();
      this.engine.handleEvent(event);
      this.feeder.handle(event);
      this.bus.emit('journal', { kind: 'event', ts: event.timestamp, event });
      if (!NOT_PERSISTED.has(event.type)) {
        this.repos.eventLog.append(this.tracker.get().sessionId, event.type, event);
      }
    });
    this.tracker.onChange((s) => this.opts.push.session(s));

    this.bus.on('journal', (entry) => {
      this.journalBuffer.push(entry);
      this.journalRecent.push(entry);
      if (this.journalRecent.length > 500) this.journalRecent.splice(0, this.journalRecent.length - 500);
      if (entry.kind === 'action' && entry.status === 'failed') {
        this.repos.eventLog.append(this.tracker.get().sessionId, 'action-failed', entry);
      }
    });
  }

  private flushJournal(): void {
    if (!this.journalBuffer.length) return;
    const batch = this.journalBuffer;
    this.journalBuffer = [];
    this.opts.push.journal(batch);
  }

  recentJournal(): JournalEntry[] {
    return [...this.journalRecent];
  }

  system(level: 'info' | 'warn' | 'error', message: string): void {
    this.opts.log(level, message);
    this.bus.emit('journal', { kind: 'system', ts: Date.now(), level, message });
  }

  // ---------------------------------------------------------------- settings

  settings(): AppSettings {
    const s = this.repos.settings;
    return {
      language: s.get(SETTINGS.language, 'fr'),
      tiktokUsername: s.get(SETTINGS.tiktokUsername, ''),
      hasSignApiKey: this.repos.secrets.has(SECRET_SIGN_KEY),
      streakMode: s.get(SETTINGS.streakMode, 'end'),
      serverPort: s.get(SETTINGS.serverPort, 21_213),
      engineConcurrency: s.get(SETTINGS.engineConcurrency, 3),
      engineMaxPerSecond: s.get(SETTINGS.engineMaxPerSecond, 20),
      apiToken: s.get(SETTINGS.apiToken, ''),
    };
  }

  updateSettings(patch: SettingsPatch): AppSettings {
    const s = this.repos.settings;
    if (patch.language) s.set(SETTINGS.language, patch.language);
    if (patch.tiktokUsername !== undefined) s.set(SETTINGS.tiktokUsername, patch.tiktokUsername.trim());
    if (patch.streakMode) {
      s.set(SETTINGS.streakMode, patch.streakMode);
      this.tiktok.setStreakMode(patch.streakMode);
      this.simulator.setStreakMode(patch.streakMode);
    }
    if (patch.serverPort !== undefined) s.set(SETTINGS.serverPort, patch.serverPort);
    if (patch.engineConcurrency !== undefined) s.set(SETTINGS.engineConcurrency, patch.engineConcurrency);
    if (patch.engineMaxPerSecond !== undefined) s.set(SETTINGS.engineMaxPerSecond, patch.engineMaxPerSecond);
    if (patch.signApiKey === null) this.repos.secrets.delete(SECRET_SIGN_KEY);
    else if (typeof patch.signApiKey === 'string' && patch.signApiKey.trim()) {
      this.repos.secrets.set(SECRET_SIGN_KEY, patch.signApiKey.trim());
    }
    return this.settings();
  }

  regenerateApiToken(): AppSettings {
    this.repos.settings.set(SETTINGS.apiToken, generateToken());
    return this.settings();
  }

  private signKeyOption(): { signApiKey?: string } {
    const key = this.repos.secrets.has(SECRET_SIGN_KEY) ? this.repos.secrets.get(SECRET_SIGN_KEY) : null;
    return key ? { signApiKey: key } : {};
  }

  // ---------------------------------------------------------------- connection

  async connectTikTok(username: string): Promise<void> {
    this.repos.settings.set(SETTINGS.tiktokUsername, username.trim());
    this.tiktok.setSignApiKey(this.signKeyOption().signApiKey);
    await this.tiktok.connect(username);
  }

  connection(): ConnectionInfo {
    return this.tiktok.getStatus();
  }

  // ---------------------------------------------------------------- simulator

  private simUser(u?: SimulatorUser) {
    return simulatedUser({
      ...(u?.username ? { username: u.username.slice(0, 24) } : {}),
      ...(u?.isModerator !== undefined ? { isModerator: u.isModerator } : {}),
      ...(u?.isSubscriber !== undefined ? { isSubscriber: u.isSubscriber } : {}),
    });
  }

  private ensureSimSession(): void {
    if (!this.tracker.get().sessionId) {
      this.bus.emit('live', {
        id: makeId('sim'),
        platform: 'simulator',
        timestamp: Date.now(),
        type: 'connected',
        channel: 'simulateur',
      });
    }
  }

  simulate(
    kind: 'gift' | 'like' | 'follow' | 'share' | 'subscribe' | 'chat' | 'rain',
    arg: unknown,
    user?: SimulatorUser,
  ): void {
    this.ensureSimSession();
    const u = this.simUser(user);
    switch (kind) {
      case 'gift': {
        const { giftId, count } = arg as { giftId: string; count: number };
        this.simulator.gift(giftId, Math.min(Math.max(1, Math.floor(count)), 500), u);
        break;
      }
      case 'like':
        this.simulator.like(Math.min(Math.max(1, Math.floor(Number(arg))), 10_000), u);
        break;
      case 'follow':
        this.simulator.follow(u);
        break;
      case 'share':
        this.simulator.share(u);
        break;
      case 'subscribe':
        this.simulator.subscribe({ ...u, isSubscriber: true });
        break;
      case 'chat':
        this.simulator.chat(String(arg).slice(0, 300), u);
        break;
      case 'rain':
        this.simulator.rain(Math.min(Math.max(1, Number(arg)), 120) * 1000);
        break;
    }
  }

  private giftsForSimulator(): GiftInfo[] {
    const list = this.catalog.list().filter((g) => g.diamonds > 0);
    return list.length ? list : SIMULATOR_GIFTS;
  }

  // ---------------------------------------------------------------- gifts

  private withLocalImage(e: LiveEvent): LiveEvent {
    if (e.type !== 'gift' || !this.images.has(e.gift.id) || !this.server.port) return e;
    return {
      ...e,
      gift: { ...e.gift, imageUrl: `${this.server.origin}/gift-img/${encodeURIComponent(e.gift.id)}` },
    };
  }

  giftList(): GiftInfo[] {
    const origin = this.server.port ? this.server.origin : null;
    // Until the real catalog is fetched, expose the simulator gifts so the app is usable offline.
    const list = this.catalog.list();
    if (!list.length) return SIMULATOR_GIFTS;
    return list.map((g) =>
      origin && this.images.has(g.id)
        ? { ...g, imageUrl: `${origin}/gift-img/${encodeURIComponent(g.id)}` }
        : g,
    );
  }

  async refreshGifts(): Promise<number> {
    const username = this.settings().tiktokUsername || this.tiktok.getStatus().channel;
    if (!username) throw new Error('Renseigne d’abord ton nom d’utilisateur TikTok');
    const gifts = await this.tiktok.fetchGifts(username);
    if (gifts.length) {
      this.catalog.replaceAll(gifts);
      void this.images.ensureMany(gifts);
    }
    return gifts.length;
  }

  private async refreshGiftsIfStale(): Promise<void> {
    if (!this.catalog.isStale(24 * 3_600_000)) return;
    try {
      const n = await this.refreshGifts();
      this.system('info', `Catalogue de cadeaux mis à jour (${n})`);
    } catch (err) {
      this.system('warn', `Catalogue de cadeaux : ${String(err)}`);
    }
  }

  // ---------------------------------------------------------------- actions

  reloadActions(): void {
    const active = this.repos.profiles.getActive();
    this.engine.setActions(active ? this.repos.actions.listByProfile(active.id) : []);
  }

  canAddAction(): boolean {
    return this.repos.actions.count() < this.entitlements.current().maxActions;
  }

  testAction(action: Action): void {
    const event: LiveEvent = {
      id: makeId('test'),
      platform: 'simulator',
      timestamp: Date.now(),
      type: 'gift',
      user: simulatedUser({ username: 'testeur' }),
      gift: this.catalog.list()[0] ?? { id: '5655', name: 'Rose', diamonds: 1 },
      count: 1,
      streakFinal: true,
    };
    this.engine.triggerManually(action, contextFromEvent(event));
  }

  private triggerActionById(id: string): boolean {
    const action = this.repos.actions.get(id);
    if (!action) return false;
    this.testAction(action);
    return true;
  }

  // ---------------------------------------------------------------- integrations

  /** Merges decrypted secrets into the plain config. */
  private withSecrets(rec: IntegrationRecord) {
    const def = this.integrations.getDefinition(rec.kind);
    const config: Record<string, unknown> = { ...rec.config };
    for (const f of def?.configFields ?? []) {
      if (!f.secret) continue;
      const v = this.repos.secrets.get(integrationSecretKey(rec.id, f.key));
      if (v !== null) config[f.key] = v;
    }
    return { ...rec, config };
  }

  integrationDto(rec: IntegrationRecord): IntegrationDto {
    const def = this.integrations.getDefinition(rec.kind);
    const secretsSet = (def?.configFields ?? [])
      .filter((f) => f.secret && this.repos.secrets.has(integrationSecretKey(rec.id, f.key)))
      .map((f) => f.key);
    return {
      id: rec.id,
      kind: rec.kind,
      name: rec.name,
      enabled: rec.enabled,
      config: rec.config,
      secretsSet,
      status: this.integrations.status(rec.id),
    };
  }

  async saveIntegration(input: IntegrationSaveInput): Promise<IntegrationDto> {
    const def = this.integrations.getDefinition(input.kind);
    if (!def) throw new Error(`Type d’intégration inconnu : ${input.kind}`);
    const secretFields = new Set(def.configFields.filter((f) => f.secret).map((f) => f.key));
    const plain: Record<string, unknown> = {};
    for (const f of def.configFields) {
      if (!secretFields.has(f.key) && f.key in input.config) plain[f.key] = input.config[f.key];
    }
    const id = input.id ?? makeId('int');
    // Validate the full config (with secrets) before persisting anything.
    const existing = this.repos.integrations.get(id);
    const merged = this.withSecrets({
      id,
      kind: input.kind,
      name: input.name,
      enabled: input.enabled,
      config: plain,
    });
    for (const key of secretFields) {
      const v = input.config[key];
      if (typeof v === 'string') merged.config[key] = v;
      if (v === null) delete merged.config[key];
    }
    def.configSchema.parse(merged.config);

    const rec = this.repos.integrations.save({
      id,
      kind: existing?.kind ?? input.kind,
      name: input.name,
      enabled: input.enabled,
      config: plain,
    });
    for (const key of secretFields) {
      const v = input.config[key];
      if (typeof v === 'string') this.repos.secrets.set(integrationSecretKey(id, key), v);
      if (v === null) this.repos.secrets.delete(integrationSecretKey(id, key));
    }
    await this.integrations.upsert(this.withSecrets(rec));
    this.opts.push.integrations();
    return this.integrationDto(rec);
  }

  async removeIntegration(id: string): Promise<void> {
    await this.integrations.remove(id);
    this.repos.integrations.delete(id);
    this.repos.secrets.deletePrefix(`integration:${id}:`);
    this.opts.push.integrations();
  }

  async testIntegration(id: string): Promise<IntegrationDto> {
    const rec = this.repos.integrations.get(id);
    if (!rec) throw new Error('Intégration introuvable');
    try {
      await this.integrations.connect(id);
    } catch (err) {
      this.system('warn', `${rec.name} : ${err instanceof Error ? err.message : String(err)}`);
    }
    return this.integrationDto(rec);
  }

  // ---------------------------------------------------------------- overlays

  overlayDto(o: OverlayConfig & { token: string }): OverlayDto {
    const { token, ...cfg } = o;
    return {
      ...cfg,
      url: this.server.port ? this.server.overlayUrl({ id: o.id, token }) : '',
      connected: this.server.connectedCount(o.id),
    };
  }

  saveOverlay(input: OverlaySaveInput): OverlayDto {
    const saved = this.repos.overlays.save(input, () => generateToken());
    this.feeder.configChanged(saved);
    return this.overlayDto(saved);
  }

  regenerateOverlayToken(id: string): OverlayDto {
    this.repos.overlays.regenerateToken(id, generateToken());
    this.server.disconnectOverlay(id);
    const o = this.repos.overlays.get(id);
    if (!o) throw new Error('Overlay introuvable');
    return this.overlayDto(o);
  }

  // ---------------------------------------------------------------- first run

  private seedDefaults(): void {
    const s = this.repos.settings;
    if (!s.get(SETTINGS.apiToken, '')) s.set(SETTINGS.apiToken, generateToken());
    if (s.get(SETTINGS.initialized, false)) return;
    if (!this.repos.profiles.list().length) this.repos.profiles.create({ name: 'Par défaut' });
    const style = OverlayStyleSchema.parse({});
    const defaults: [OverlayKind, string, Record<string, unknown>][] = [
      ['alerts', 'Alertes cadeaux', {}],
      ['top-donors', 'Top donateurs', {}],
      ['like-goal', 'Objectif de likes', {}],
    ];
    for (const [kind, name, options] of defaults) {
      this.repos.overlays.save({ kind, name, style, options }, () => generateToken());
    }
    this.repos.integrations.save({
      kind: 'input',
      name: 'Clavier & souris',
      enabled: true,
      config: { stepDelayMs: 30 },
    });
    s.set(SETTINGS.initialized, true);
  }
}
