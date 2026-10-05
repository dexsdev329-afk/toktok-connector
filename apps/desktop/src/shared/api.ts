/**
 * Contract between the renderer and the main process (IPC).
 * Every method is validated again in the main process: the renderer is never trusted.
 */
import type {
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
    get(): Promise<ConnectionInfo>;
    connect(username: string): Promise<void>;
    disconnect(): Promise<void>;
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
  };
  overlays: {
    list(): Promise<OverlayDto[]>;
    save(input: OverlaySaveInput): Promise<OverlayDto>;
    remove(id: string): Promise<void>;
    regenerateToken(id: string): Promise<OverlayDto>;
    open(id: string): Promise<void>;
  };
  engine: {
    clearQueue(): Promise<void>;
    stats(): Promise<{ pending: number; running: number }>;
  };
  journal: {
    recent(): Promise<JournalEntry[]>;
  };
  settings: {
    get(): Promise<AppSettings>;
    update(patch: SettingsPatch): Promise<AppSettings>;
    regenerateApiToken(): Promise<AppSettings>;
  };
}

/** Push channels main -> renderer. */
export interface PushEvents {
  connection: ConnectionInfo;
  session: SessionInfo;
  journal: JournalEntry[];
  integrations: void;
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
