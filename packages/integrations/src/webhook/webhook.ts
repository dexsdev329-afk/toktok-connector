import { renderTemplate, type Effect, type TemplateContext } from '@toktok/shared';
import { z } from 'zod';
import {
  IntegrationError,
  numberParam,
  stringParam,
  type Integration,
  type IntegrationDefinition,
  type IntegrationStatus,
} from '../sdk';

export const WebhookConfigSchema = z.object({
  /** Optional base URL; effect URLs starting with "/" are resolved against it. */
  baseUrl: z
    .string()
    .max(500)
    .refine((v) => v === '' || /^https?:\/\//i.test(v), 'URL http(s) attendue')
    .default(''),
  /** Sent as the Authorization header (stored encrypted). */
  authorization: z.string().max(1000).default(''),
  timeoutMs: z.coerce.number().int().min(500).max(60_000).default(10_000),
});
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** Builds the request of an effect. Variables in the URL are URL-encoded, in the body JSON-escaped. */
export function buildWebhookRequest(
  effect: Effect,
  ctx: TemplateContext,
  config: WebhookConfig,
): { url: string; init: RequestInit } {
  const method = (METHODS as readonly string[]).includes(stringParam(effect, 'method', 'POST').toUpperCase())
    ? stringParam(effect, 'method', 'POST').toUpperCase()
    : 'POST';
  const rawUrl = renderTemplate(stringParam(effect, 'url'), ctx, 'url');
  let url: URL;
  try {
    url = config.baseUrl && rawUrl.startsWith('/') ? new URL(rawUrl, config.baseUrl) : new URL(rawUrl);
  } catch {
    throw new IntegrationError(`URL invalide : ${rawUrl || '(vide)'}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new IntegrationError('Seules les URL http(s) sont autorisées');
  }
  const headers: Record<string, string> = { 'User-Agent': 'TokTok-Game-Connector-Live' };
  if (config.authorization) headers.Authorization = config.authorization;
  const init: RequestInit = { method, headers, redirect: 'follow' };
  if (method !== 'GET' && method !== 'DELETE') {
    const template = stringParam(effect, 'body');
    // Empty body template: send the whole context as JSON.
    const body = template.trim() ? renderTemplate(template, ctx, 'json') : JSON.stringify(ctx);
    headers['Content-Type'] = 'application/json';
    init.body = body;
  }
  return { url: url.toString(), init };
}

export class WebhookIntegration implements Integration {
  private state: IntegrationStatus = { state: 'connected' };

  constructor(
    private readonly config: WebhookConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  status(): IntegrationStatus {
    return this.state;
  }

  listEffects() {
    return webhookDefinition.effects;
  }

  async connect(): Promise<void> {
    if (!this.config.baseUrl) return;
    try {
      const res = await this.fetchImpl(this.config.baseUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      this.state = { state: 'connected', detail: `HTTP ${res.status}` };
    } catch (err) {
      this.state = { state: 'error', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  async disconnect(): Promise<void> {}

  async execute(effect: Effect, ctx: TemplateContext, signal: AbortSignal): Promise<void> {
    if (effect.effectId !== 'http.request') throw new IntegrationError(`Effet inconnu: ${effect.effectId}`);
    const { url, init } = buildWebhookRequest(effect, ctx, this.config);
    const timeout = numberParam(effect, 'timeoutMs', this.config.timeoutMs, 500, 60_000);
    const res = await this.fetchImpl(url, {
      ...init,
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
    });
    if (!res.ok) {
      this.state = { state: 'error', detail: `HTTP ${res.status} sur ${new URL(url).host}` };
      throw new IntegrationError(`HTTP ${res.status} ${res.statusText}`);
    }
    this.state = { state: 'connected', detail: `HTTP ${res.status}` };
  }
}

export const webhookDefinition: IntegrationDefinition<WebhookConfig> = {
  kind: 'webhook',
  name: 'HTTP / Webhook',
  description: 'Appelle une URL (tes jeux web sur Railway, un bot, n’importe quelle API) à chaque action.',
  configFields: [
    {
      key: 'baseUrl',
      label: 'integrations.webhook.baseUrl',
      type: 'string',
      help: 'integrations.webhook.baseUrlHelp',
    },
    { key: 'authorization', label: 'integrations.webhook.authorization', type: 'password', secret: true },
    {
      key: 'timeoutMs',
      label: 'integrations.webhook.timeoutMs',
      type: 'number',
      default: 10_000,
      min: 500,
      max: 60_000,
    },
  ],
  configSchema: WebhookConfigSchema,
  effects: [
    {
      id: 'http.request',
      name: 'Requête HTTP',
      description:
        'Corps vide = tout le contexte en JSON. Variables : {username} {giftName} {count} {diamonds}…',
      params: [
        {
          key: 'method',
          label: 'webhook.method',
          type: 'select',
          default: 'POST',
          options: METHODS.map((m) => ({ value: m, label: m })),
        },
        {
          key: 'url',
          label: 'webhook.url',
          type: 'string',
          placeholder: 'https://mon-jeu.up.railway.app/api/event',
        },
        {
          key: 'body',
          label: 'webhook.body',
          type: 'text',
          placeholder: '{"type":"gift","user":"{username}","count":{count}}',
        },
      ],
    },
  ],
  create: (config) => new WebhookIntegration(config),
};
