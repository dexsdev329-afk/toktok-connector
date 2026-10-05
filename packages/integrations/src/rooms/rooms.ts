import { renderTemplate, type Effect, type LiveEvent, type TemplateContext } from '@toktok/shared';
import WebSocket from 'ws';
import { z } from 'zod';
import {
  IntegrationError,
  stringParam,
  type Integration,
  type IntegrationDefinition,
  type IntegrationDeps,
  type IntegrationStatus,
} from '../sdk';

export const RoomsConfigSchema = z.object({
  url: z
    .string()
    .max(300)
    .refine((v) => /^wss?:\/\//i.test(v), 'URL ws:// ou wss:// attendue'),
  room: z.coerce.number().int().min(1).max(100),
  pin: z.string().min(4).max(64),
  /** Forward every live event (gift, like, chat...) to the games of the room. */
  forwardEvents: z.boolean().default(true),
});
export type RoomsConfig = z.infer<typeof RoomsConfigSchema>;

export type SocketFactory = (url: string) => WebSocket;

/**
 * Client of the multi-room relay (apps/rooms-server on Railway): the app joins a
 * room as "publisher" and browser games join it as "game".
 */
export class RoomsIntegration implements Integration {
  readonly autoStart = true;
  private ws: WebSocket | null = null;
  private wanted = false;
  private retry = 1000;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private state: IntegrationStatus = { state: 'disconnected' };
  private joined = false;

  constructor(
    private readonly config: RoomsConfig,
    private readonly deps: IntegrationDeps,
    private readonly factory: SocketFactory = (url) => new WebSocket(url),
  ) {}

  status(): IntegrationStatus {
    return this.state;
  }

  listEffects() {
    return roomsDefinition.effects;
  }

  async connect(): Promise<void> {
    if (this.wanted) return;
    this.wanted = true;
    this.open();
  }

  async disconnect(): Promise<void> {
    this.wanted = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ws?.close();
    this.ws = null;
    this.joined = false;
    this.state = { state: 'disconnected' };
  }

  onLiveEvent(event: LiveEvent): void {
    if (this.config.forwardEvents) this.sendJson({ type: 'event', event });
  }

  async execute(effect: Effect, ctx: TemplateContext): Promise<void> {
    if (effect.effectId !== 'rooms.effect') throw new IntegrationError(`Effet inconnu: ${effect.effectId}`);
    const name = stringParam(effect, 'effect').trim();
    if (!name) throw new IntegrationError('Nom d’effet manquant');
    const raw = stringParam(effect, 'params').trim();
    let params: unknown;
    try {
      params = raw ? JSON.parse(renderTemplate(raw, ctx, 'json')) : {};
    } catch {
      throw new IntegrationError('Paramètres JSON invalides');
    }
    if (!this.sendJson({ type: 'effect', effect: name, params, context: ctx })) {
      throw new IntegrationError('Serveur de salles non connecté');
    }
  }

  private sendJson(msg: unknown): boolean {
    if (!this.joined || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private open(): void {
    if (!this.wanted) return;
    this.state = { state: 'connecting', detail: `Salle ${this.config.room}` };
    this.deps.statusChanged?.();
    const ws = this.factory(this.config.url);
    this.ws = ws;
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'join',
          room: this.config.room,
          pin: this.config.pin,
          role: 'publisher',
          name: 'TokTok app',
        }),
      );
    });
    ws.on('message', (data) => {
      let msg: { type?: string; games?: number; message?: string; data?: unknown; from?: string };
      try {
        msg = JSON.parse(String(data)) as typeof msg;
      } catch {
        return;
      }
      if (msg.type === 'joined' || msg.type === 'presence') {
        this.joined = true;
        this.retry = 1000;
        this.state = {
          state: 'connected',
          detail: `Salle ${this.config.room} — ${msg.games ?? 0} jeu(x) connecté(s)`,
        };
        this.deps.statusChanged?.();
      } else if (msg.type === 'error') {
        this.deps.log('warn', `Serveur de salles : ${msg.message ?? 'erreur'}`);
      } else if (msg.type === 'game') {
        this.deps.log('info', `[Jeu ${msg.from ?? ''}] ${JSON.stringify(msg.data).slice(0, 200)}`);
      }
    });
    ws.on('close', (code) => {
      this.joined = false;
      if (this.ws === ws) this.ws = null;
      if (!this.wanted) return;
      if (code === 4003 || code === 4008) {
        // Wrong PIN or locked: retrying would only extend the lock.
        this.wanted = false;
        this.state = {
          state: 'error',
          detail: code === 4003 ? 'Salle ou PIN invalide' : 'Trop d’essais, réessaie plus tard',
        };
        this.deps.statusChanged?.();
        return;
      }
      this.state = { state: 'connecting', detail: 'Reconnexion…' };
      this.deps.statusChanged?.();
      this.timer = setTimeout(() => this.open(), this.retry);
      this.retry = Math.min(this.retry * 2, 30_000);
    });
    ws.on('error', () => undefined);
  }
}

export const roomsDefinition: IntegrationDefinition<RoomsConfig> = {
  kind: 'rooms',
  name: 'Serveur de salles (jeux navigateur)',
  description:
    'Relie l’app à ton serveur multi-salles sur Railway : tes jeux web (Three.js…) reçoivent les événements du live et les effets.',
  configFields: [
    { key: 'url', label: 'integrations.rooms.url', type: 'string', default: 'wss://' },
    { key: 'room', label: 'integrations.rooms.room', type: 'number', default: 1, min: 1, max: 100 },
    { key: 'pin', label: 'integrations.rooms.pin', type: 'password', secret: true },
    { key: 'forwardEvents', label: 'integrations.rooms.forwardEvents', type: 'boolean', default: true },
  ],
  configSchema: RoomsConfigSchema,
  effects: [
    {
      id: 'rooms.effect',
      name: 'Effet pour les jeux de la salle',
      description: 'Envoie {type:"effect", effect, params, context} aux jeux connectés.',
      params: [
        { key: 'effect', label: 'rooms.effect', type: 'string', placeholder: 'bonus_coins' },
        {
          key: 'params',
          label: 'rooms.params',
          type: 'text',
          placeholder: '{"amount": {count}, "by": "{username}"}',
        },
      ],
    },
  ],
  create: (config, deps) => new RoomsIntegration(config, deps),
};
