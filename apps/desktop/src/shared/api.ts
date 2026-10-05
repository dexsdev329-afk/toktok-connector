/**
 * Contract between the renderer and the main process (IPC).
 * Every method is validated again in the main process: the renderer is never trusted.
 */
import type {
  OverlayStyle,
  OverlayThemeDef,
  Action,
  ActionInput,
  Effect,
  GiftInfo,
  JournalEntry,
  OverlayConfig,
  Profile,
} from '@toktok/shared';

export type ConnectionStatus =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'waiting-live' | 'error';

export interface ConnectionInfo {
  status: ConnectionStatus;
  channel: string | null;
  detail?: string;
  retryAt?: number;
}

/** Live platforms the app can connect to (both can be live at the same time). */
export type LivePlatform = 'tiktok' | 'kick';
export const LIVE_PLATFORMS: readonly LivePlatform[] = ['tiktok', 'kick'];
export type Connections = Record<LivePlatform, ConnectionInfo>;

export interface SessionInfo {
  sessionId: string | null;
  channel: string | null;
  likes: number;
  viewers: number;
  diamonds: number;
  followers: number;
}

export interface AppSettings {
  language: 'fr' | 'en';
  tiktokUsername: string;
  kickChannel: string;
  hasSignApiKey: boolean;
  streakMode: 'end' | 'repeat';
  serverPort: number;
  engineConcurrency: number;
  engineMaxPerSecond: number;
  apiToken: string;
}

export type SettingsPatch = Partial<
  Omit<AppSettings, 'hasSignApiKey' | 'apiToken'> & {
    /** null removes the key, undefined keeps it. */
    signApiKey: string | null;
  }
>;

export interface ConfigFieldDto {
  key: string;
  label: string;
  type: 'string' | 'number' | 'password' | 'boolean' | 'select';
  secret?: boolean;
  default?: string | number | boolean;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  help?: string;
  autoGenerate?: 'token';
}

export interface EffectDefinitionDto {
  id: string;
  name: string;
  description?: string;
  params: {
    key: string;
    label: string;
    type: 'string' | 'text' | 'number' | 'boolean' | 'select';
    default?: string | number | boolean;
    options?: { value: string; label: string }[];
    placeholder?: string;
    help?: string;
    min?: number;
    max?: number;
  }[];
}

export interface IntegrationDefinitionDto {
  kind: string;
  name: string;
  description: string;
  configFields: ConfigFieldDto[];
  effects: EffectDefinitionDto[];
  presets: {
    id: string;
    name: string;
    category: string;
    effectId: string;
    params: Record<string, unknown>;
  }[];
}

export interface IntegrationDto {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  /** Non-secret config values. */
  config: Record<string, unknown>;
  /** Secret fields that have a stored value. */
  secretsSet: string[];
  status: { state: 'disconnected' | 'connecting' | 'connected' | 'error'; detail?: string };
  /** Effects of this instance (bridges include the effects declared by connected mods). */
  effects: EffectDefinitionDto[];
}

export interface IntegrationSaveInput {
  id?: string;
  kind: string;
  name: string;
  enabled: boolean;
  /** Secret fields: string = new value, null = delete, absent = keep. */
  config: Record<string, unknown>;
}

export interface OverlayDto extends OverlayConfig {
  url: string;
  connected: number;
}

export type OverlaySaveInput = Omit<OverlayConfig, 'id'> & { id?: string };

export interface SimulatorUser {
  username?: string;
  isModerator?: boolean;
  isSubscriber?: boolean;
}

export interface DesktopApi {
  app: {
    info(): Promise<{ version: string; dataDir: string; serverOrigin: string }>;
  };
  connection: {
    get(): Promise<Connections>;
    connect(platform: LivePlatform, channel: string): Promise<void>;
    disconnect(platform: LivePlatform): Promise<void>;
  };
  session: {
    get(): Promise<SessionInfo>;
    reset(): Promise<void>;
  };
  simulator: {
    gift(giftId: string, count: number, user?: SimulatorUser): Promise<void>;
    like(count: number, user?: SimulatorUser): Promise<void>;
    follow(user?: SimulatorUser): Promise<void>;
    share(user?: SimulatorUser): Promise<void>;
    subscribe(user?: SimulatorUser): Promise<void>;
    chat(text: string, user?: SimulatorUser): Promise<void>;
    rain(seconds: number): Promise<void>;
  };
  gifts: {
    list(): Promise<GiftInfo[]>;
    refresh(): Promise<number>;
  };
  profiles: {
    list(): Promise<Profile[]>;
    create(name: string, game: string): Promise<Profile>;
    update(id: string, name: string, game: string): Promise<Profile>;
    remove(id: string): Promise<void>;
    activate(id: string): Promise<void>;
    exportToFile(id: string): Promise<boolean>;
    importFromFile(): Promise<Profile | null>;
    /** Creates a ready-to-use Minecraft profile bound to a Minecraft integration. */
    createMinecraftPack(integrationId: string): Promise<Profile>;
  };
  actions: {
    list(profileId: string): Promise<Action[]>;
    save(action: Omit<ActionInput, 'id'> & { id?: string }): Promise<Action>;
    remove(id: string): Promise<void>;
    test(id: string): Promise<void>;
    /** Runs a single effect right now (editor "test" button). */
    testEffect(effect: Effect): Promise<void>;
  };
  integrations: {
    definitions(): Promise<IntegrationDefinitionDto[]>;
    list(): Promise<IntegrationDto[]>;
    save(input: IntegrationSaveInput): Promise<IntegrationDto>;
    remove(id: string): Promise<void>;
    test(id: string): Promise<IntegrationDto>;
    changeRoomPin(id: string, pin: string): Promise<IntegrationDto>;
  };
  overlays: {
    list(): Promise<OverlayDto[]>;
    save(input: OverlaySaveInput): Promise<OverlayDto>;
    remove(id: string): Promise<void>;
    regenerateToken(id: string): Promise<OverlayDto>;
    open(id: string): Promise<void>;
    spinWheel(id: string): Promise<void>;
    /** Applies one style to every overlay. */
    applyStyleToAll(style: OverlayStyle): Promise<void>;
    timer(
      id: string,
      op: 'start' | 'pause' | 'toggle' | 'reset' | 'add' | 'set',
      seconds?: number,
    ): Promise<void>;
  };
  minecraft: {
    server(): Promise<MinecraftServerState>;
    versions(): Promise<{ latest: string; versions: string[] }>;
    install(version: string, acceptEula: boolean): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    openFolder(): Promise<void>;
    /** Address to type in Minecraft (Multiplayer -> Add server). */
    address(): Promise<string>;
    /** Creates (once) the Bedrock integration and its gift profile; returns the /connect command. */
    setupBedrock(): Promise<{ command: string; integrationId: string }>;
    /** Spawns a test zombie through the configured integration. */
    test(edition: 'java' | 'bedrock'): Promise<void>;
  };
  updates: {
    get(): Promise<UpdateState>;
    check(): Promise<UpdateState>;
    download(): Promise<void>;
    install(): Promise<void>;
    setAutoCheck(on: boolean): Promise<UpdateState>;
  };
  themes: {
    /** User themes (the built-in presets live in @toktok/shared). */
    list(): Promise<OverlayThemeDef[]>;
    save(name: string, style: OverlayStyle): Promise<OverlayThemeDef>;
    remove(id: string): Promise<void>;
  };
  engine: {
    clearQueue(): Promise<void>;
    stats(): Promise<{ pending: number; running: number }>;
  };
  journal: {
    recent(): Promise<JournalEntry[]>;
  };
  media: {
    ended(id: string): Promise<void>;
  };
  homeGames: {
    list(): Promise<HomeGameDto[]>;
    addUrl(name: string, url: string): Promise<HomeGameDto>;
    addFolder(name: string): Promise<HomeGameDto | null>;
    remove(id: string): Promise<void>;
    open(id: string): Promise<void>;
  };
  sounds: {
    list(): Promise<SoundDto[]>;
    importFiles(): Promise<SoundDto[]>;
    update(id: string, name: string, volume: number): Promise<void>;
    remove(id: string): Promise<void>;
    play(id: string): Promise<void>;
    getVolume(): Promise<number>;
    setVolume(v: number): Promise<void>;
  };
  tts: {
    get(): Promise<TtsState>;
    update(
      patch: Partial<Omit<TtsState, 'hasElevenlabsKey'>>,
      elevenlabsKey?: string | null,
    ): Promise<TtsState>;
    voices(): Promise<string[]>;
    test(text: string): Promise<void>;
    skip(): Promise<void>;
  };
  settings: {
    get(): Promise<AppSettings>;
    update(patch: SettingsPatch): Promise<AppSettings>;
    regenerateApiToken(): Promise<AppSettings>;
  };
}

/** Personal Minecraft Java server managed by the app ("Minecraft en 1 clic"). */
export interface MinecraftServerState {
  status: 'not-installed' | 'installing' | 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  version: string | null;
  /** Current step and progress while installing / starting. */
  step?: string;
  percent?: number;
  error?: string;
  /** Players currently connected. */
  players: string[];
  /** Last console lines. */
  logs: string[];
}

export interface UpdateState {
  /** "disabled" in development or outside Windows. */
  status:
    'disabled' | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  currentVersion: string;
  version?: string;
  notes?: string;
  percent?: number;
  error?: string;
  checkedAt?: number;
  autoCheck: boolean;
}

/** Audio requests played by the renderer. */
export type MediaRequest =
  | { id: string; kind: 'audio'; src: string; volume: number }
  | { id: string; kind: 'speech'; text: string; voice: string; rate: number; volume: number }
  | { id: string; kind: 'stop' };

export interface TtsState {
  enabled: boolean;
  engine: 'sapi' | 'browser' | 'elevenlabs';
  voice: string;
  rate: number;
  volume: number;
  readChat: 'off' | 'all' | 'subscribers' | 'moderators';
  skipCommands: boolean;
  giftMinDiamonds: number;
  giftTemplate: string;
  chatTemplate: string;
  filterMode: 'off' | 'censor' | 'skip';
  customWords: string[];
  maxLength: number;
  maxQueue: number;
  elevenlabsVoiceId: string;
  hasElevenlabsKey: boolean;
}

export interface SoundDto {
  id: string;
  name: string;
  volume: number;
}

export interface HomeGameDto {
  id: string;
  name: string;
  source: string;
  /** URL with the private local WebSocket address (window / OBS). */
  launchUrl: string;
  connected: number;
}

/** Push channels main -> renderer. */
export interface PushEvents {
  connection: { platform: LivePlatform; info: ConnectionInfo };
  session: SessionInfo;
  journal: JournalEntry[];
  integrations: void;
  media: MediaRequest;
  updates: UpdateState;
  minecraft: MinecraftServerState;
}

export type ApiNamespace = keyof DesktopApi;

export interface BridgeApi {
  invoke<N extends ApiNamespace, M extends keyof DesktopApi[N]>(
    ns: N,
    method: M,
    ...args: DesktopApi[N][M] extends (...a: infer A) => unknown ? A : never
  ): DesktopApi[N][M] extends (...a: never[]) => infer R ? R : never;
  on<K extends keyof PushEvents>(channel: K, listener: (payload: PushEvents[K]) => void): () => void;
}
