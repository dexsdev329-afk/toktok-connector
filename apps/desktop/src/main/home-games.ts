import { stat } from 'node:fs/promises';
import { generateToken, type LocalServer, type SettingsRepo } from '@toktok/core';
import {
  IntegrationError,
  stringParam,
  type Integration,
  type IntegrationDefinition,
} from '@toktok/integrations';
import { makeId, renderTemplate, type LiveEvent } from '@toktok/shared';
import { z } from 'zod';
import type { HomeGameDto } from '../shared/api';

export interface HomeGame {
  id: string;
  name: string;
  /** Hosted game (Railway...) or local folder served by the app. */
  url?: string;
  folder?: string;
  token: string;
}

const HomeGameSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  url: z
    .string()
    .max(500)
    .refine((v) => /^https?:\/\//i.test(v))
    .optional(),
  folder: z.string().max(1000).optional(),
  token: z.string().min(16),
});

const KEY = 'homeGames';

/** "Jeux maison": the streamer's own web games, fed with live events over the local server. */
export class HomeGames {
  constructor(
    private readonly settings: SettingsRepo,
    private readonly server: LocalServer,
  ) {}

  list(): HomeGame[] {
    const raw = this.settings.get<unknown[]>(KEY, []);
    return raw.flatMap((g) => {
      const r = HomeGameSchema.safeParse(g);
      return r.success ? [r.data as HomeGame] : [];
    });
  }

  get(id: string): HomeGame | null {
    return this.list().find((g) => g.id === id) ?? null;
  }

  async add(input: { name: string; url?: string; folder?: string }): Promise<HomeGame> {
    if (!input.url === !input.folder) throw new Error('Indique une URL ou un dossier');
    if (input.folder && !(await stat(input.folder)).isDirectory()) throw new Error('Dossier introuvable');
    const game = HomeGameSchema.parse({
      id: makeId('game'),
      name: input.name.trim(),
      ...(input.url ? { url: input.url.trim() } : {}),
      ...(input.folder ? { folder: input.folder } : {}),
      token: generateToken(),
    }) as HomeGame;
    this.settings.set(KEY, [...this.list(), game]);
    return game;
  }

  remove(id: string): void {
    this.settings.set(
      KEY,
      this.list().filter((g) => g.id !== id),
    );
  }

  /** URL to open in a window or paste into OBS (carries the private WebSocket address). */
  launchUrl(game: HomeGame): string {
    const base = game.folder ? `${this.server.origin}/games/${encodeURIComponent(game.id)}/` : game.url!;
    const u = new URL(base);
    u.searchParams.set('toktok_ws', this.server.gameWsUrl(game));
    return u.toString();
  }

  dto(game: HomeGame): HomeGameDto {
    return {
      id: game.id,
      name: game.name,
      source: game.folder ? `📁 ${game.folder}` : game.url!,
      launchUrl: this.server.port ? this.launchUrl(game) : '',
      connected: this.server.gameConnectedCount(game.id),
    };
  }

  broadcast(event: LiveEvent): void {
    this.server.sendToGame('*', { type: 'event', event });
  }

  sendEffect(gameId: string, effect: string, params: unknown, context: unknown): number {
    const targets =
      gameId === '*' ? this.list() : this.list().filter((g) => g.id === gameId || g.name === gameId);
    for (const g of targets) this.server.sendToGame(g.id, { type: 'effect', effect, params, context });
    return targets.reduce((n, g) => n + this.server.gameConnectedCount(g.id), 0);
  }
}

/** Built-in integration so actions can send effects to home games. */
export function homeGamesDefinition(games: HomeGames): IntegrationDefinition<Record<string, never>> {
  const definition: IntegrationDefinition<Record<string, never>> = {
    kind: 'home-games',
    name: 'Jeux maison',
    description: 'Tes jeux web (dossier local ou URL) reçoivent les événements du live et les effets.',
    configFields: [],
    configSchema: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
    effects: [
      {
        id: 'homegame.effect',
        name: 'Effet pour un jeu maison',
        description:
          'Jeu : son nom, son id, ou * pour tous. Le jeu reçoit {type:"effect", effect, params, context}.',
        params: [
          { key: 'game', label: 'homeGames.game', type: 'string', default: '*' },
          { key: 'effect', label: 'rooms.effect', type: 'string', placeholder: 'bonus_coins' },
          { key: 'params', label: 'rooms.params', type: 'text', placeholder: '{"amount": {count}}' },
        ],
      },
    ],
    create: (): Integration => ({
      status: () => ({ state: 'connected', detail: `${games.list().length} jeu(x)` }),
      listEffects: () => definition.effects,
      connect: async () => {},
      disconnect: async () => {},
      onLiveEvent: (event) => games.broadcast(event),
      execute: async (effect, ctx) => {
        const name = stringParam(effect, 'effect').trim();
        if (!name) throw new IntegrationError('Nom d’effet manquant');
        const raw = stringParam(effect, 'params').trim();
        let params: unknown;
        try {
          params = raw ? JSON.parse(renderTemplate(raw, ctx, 'json')) : {};
        } catch {
          throw new IntegrationError('Paramètres JSON invalides');
        }
        const reached = games.sendEffect(stringParam(effect, 'game', '*').trim() || '*', name, params, ctx);
        if (reached === 0) throw new IntegrationError('Aucun jeu maison ouvert');
      },
    }),
  };
  return definition;
}
