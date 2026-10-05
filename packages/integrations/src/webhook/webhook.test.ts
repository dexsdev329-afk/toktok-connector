import { contextFromEvent, EffectSchema, type LiveEvent } from '@toktok/shared';
import { describe, expect, it } from 'vitest';
import { buildWebhookRequest, WebhookConfigSchema, WebhookIntegration } from './webhook';

const event: LiveEvent = {
  id: 'e',
  platform: 'simulator',
  timestamp: 0,
  type: 'gift',
  user: {
    id: '1',
    username: 'bob',
    displayName: 'Bob "B" & co',
    isModerator: false,
    isSubscriber: false,
    isFollower: false,
  },
  gift: { id: '5655', name: 'Rose', diamonds: 1 },
  count: 2,
  streakFinal: true,
};
const ctx = contextFromEvent(event);
const fx = (params: Record<string, unknown>) =>
  EffectSchema.parse({ integrationId: 'w', effectId: 'http.request', params });
const cfg = (over: Record<string, unknown> = {}) => WebhookConfigSchema.parse(over);

describe('webhook', () => {
  it('escapes variables in URL and JSON body', () => {
    const { url, init } = buildWebhookRequest(
      fx({
        method: 'POST',
        url: 'https://x.test/e?u={displayName}',
        body: '{"u":"{displayName}","n":{count}}',
      }),
      ctx,
      cfg({ authorization: 'Bearer k' }),
    );
    expect(url).toBe('https://x.test/e?u=Bob%20%22B%22%20%26%20co');
    expect(JSON.parse(String(init.body))).toEqual({ u: 'Bob "B" & co', n: 2 });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
  });

  it('sends the whole context when the body is empty, resolves relative URLs', () => {
    const { url, init } = buildWebhookRequest(
      fx({ url: '/api/event' }),
      ctx,
      cfg({ baseUrl: 'https://game.test' }),
    );
    expect(url).toBe('https://game.test/api/event');
    expect(JSON.parse(String(init.body))).toMatchObject({ username: 'bob', count: 2, giftName: 'Rose' });
  });

  it('rejects non-http URLs and GET bodies', () => {
    expect(() => buildWebhookRequest(fx({ url: 'file:///etc/passwd' }), ctx, cfg())).toThrow(/http/);
    expect(() => buildWebhookRequest(fx({ url: '' }), ctx, cfg())).toThrow(/URL invalide/);
    expect(
      buildWebhookRequest(fx({ method: 'GET', url: 'https://x.test' }), ctx, cfg()).init.body,
    ).toBeUndefined();
  });

  it('fails on non-2xx responses', async () => {
    const integ = new WebhookIntegration(
      cfg(),
      (async () => new Response('no', { status: 500 })) as typeof fetch,
    );
    await expect(
      integ.execute(fx({ url: 'https://x.test' }), ctx, new AbortController().signal),
    ).rejects.toThrow(/500/);
    expect(integ.status().state).toBe('error');
  });
});
