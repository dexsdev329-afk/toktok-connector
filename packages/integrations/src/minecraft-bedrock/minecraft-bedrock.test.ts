import { contextFromEvent, EffectSchema, type LiveEvent } from '@toktok/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { BedrockConfigSchema, MinecraftBedrockIntegration } from './minecraft-bedrock';

const event: LiveEvent = {
  id: 'e',
  platform: 'simulator',
  timestamp: 0,
  type: 'follow',
  user: {
    id: '1',
    username: 'bob',
    displayName: 'Bob',
    isModerator: false,
    isSubscriber: false,
    isFollower: true,
  },
};
const ctx = contextFromEvent(event);
const fx = (effectId: string, params: Record<string, unknown>) =>
  EffectSchema.parse({ integrationId: 'b', effectId, params });

let integ: MinecraftBedrockIntegration | null = null;
afterEach(async () => {
  await integ?.disconnect();
  integ = null;
});

/** Fake Bedrock client answering every commandRequest. */
function fakeGame(port: number, opts: { status?: (cmd: string) => number; origin?: string } = {}) {
  const received: { purpose: string; command?: string }[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, opts.origin ? { origin: opts.origin } : {});
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data)) as {
      header: { requestId: string; messagePurpose: string };
      body: { commandLine?: string };
    };
    received.push({
      purpose: msg.header.messagePurpose,
      ...(msg.body.commandLine ? { command: msg.body.commandLine } : {}),
    });
    if (msg.header.messagePurpose === 'commandRequest') {
      const code = opts.status?.(msg.body.commandLine ?? '') ?? 0;
      ws.send(
        JSON.stringify({
          header: { requestId: msg.header.requestId, messagePurpose: 'commandResponse', version: 1 },
          body: { statusCode: code, statusMessage: code ? 'Syntax error' : 'ok' },
        }),
      );
    }
  });
  const opened = new Promise<boolean>((resolve) => {
    ws.on('open', () => resolve(true));
    ws.on('error', () => resolve(false));
    ws.on('unexpected-response', () => resolve(false));
  });
  return { ws, received, opened };
}

async function waitFor(cond: () => boolean, ms = 2000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('MinecraftBedrockIntegration', () => {
  it('waits for the game, then sends commands and reads responses', async () => {
    const logs: string[] = [];
    let changes = 0;
    integ = new MinecraftBedrockIntegration(
      { ...BedrockConfigSchema.parse({}), port: 0 },
      {
        log: (_l, m) => logs.push(m),
        statusChanged: () => changes++,
      },
    );
    await integ.connect();
    expect(integ.status().state).toBe('connecting');
    await expect(
      integ.execute(fx('mc.weather', { weather: 'rain' }), ctx, new AbortController().signal),
    ).rejects.toThrow(/connect localhost/);

    const game = fakeGame(integ.port, { status: (c) => (c.startsWith('kill') ? 1 : 0) });
    expect(await game.opened).toBe(true);
    await waitFor(() => integ!.status().state === 'connected');
    expect(changes).toBe(1);

    await integ.execute(
      fx('mc.effect', { effect: 'speed', seconds: 5, level: 1 }),
      ctx,
      new AbortController().signal,
    );
    await integ.execute(
      fx('bedrock.command', { command: 'kill {player}' }),
      ctx,
      new AbortController().signal,
    );
    const commands = game.received.filter((r) => r.purpose === 'commandRequest').map((r) => r.command);
    expect(commands).toEqual([
      'title @s actionbar TokTok Game Connector Live : connecté',
      'effect @s speed 5 0',
      'kill @s',
    ]);
    expect(logs.some((l) => l.includes('Syntax error'))).toBe(true);

    game.ws.close();
    await waitFor(() => integ!.status().state === 'connecting');
  });

  it('refuses browser connections (Origin header)', async () => {
    integ = new MinecraftBedrockIntegration({ ...BedrockConfigSchema.parse({}), port: 0 }, { log: () => {} });
    await integ.connect();
    const browser = fakeGame(integ.port, { origin: 'https://evil.example' });
    expect(await browser.opened).toBe(false);
    expect(integ.status().state).toBe('connecting');
  });

  it('times out when the game does not answer', async () => {
    integ = new MinecraftBedrockIntegration(
      { ...BedrockConfigSchema.parse({}), port: 0, commandTimeoutMs: 500 },
      { log: () => {} },
    );
    await integ.connect();
    const ws = new WebSocket(`ws://127.0.0.1:${integ.port}`); // never answers
    await new Promise((r) => ws.on('open', r));
    await waitFor(() => integ!.status().state === 'connected');
    await expect(integ.send('say hi')).rejects.toThrow(/Pas de réponse/);
    ws.close();
  });
});
