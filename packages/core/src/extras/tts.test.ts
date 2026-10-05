import type { LiveEvent, LiveUser } from '@toktok/shared';
import { describe, expect, it } from 'vitest';
import { TtsService, TtsSettingsSchema, type TtsSettings } from './tts';

const user = (over: Partial<LiveUser> = {}): LiveUser => ({
  id: '1',
  username: 'bob',
  displayName: 'Bob',
  isModerator: false,
  isSubscriber: false,
  isFollower: false,
  ...over,
});
const chat = (text: string, u = user()): LiveEvent => ({
  id: 'c',
  platform: 'simulator',
  timestamp: 0,
  type: 'chat',
  user: u,
  text,
});

function setup(over: Partial<TtsSettings> = {}) {
  const spoken: string[] = [];
  let release: (() => void) | null = null;
  const settings = TtsSettingsSchema.parse({ enabled: true, ...over });
  const tts = new TtsService(() => settings, {
    sapi: {
      speak: (text) =>
        new Promise<void>((resolve) => {
          spoken.push(text);
          release = resolve;
        }),
    },
  });
  const next = async () => {
    release?.();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { tts, spoken, next };
}

describe('TtsService', () => {
  it('reads chat according to the role filter and skips commands', async () => {
    const { tts, spoken, next } = setup({ readChat: 'subscribers' });
    tts.handleEvent(chat('salut tout le monde'));
    tts.handleEvent(chat('!tnt', user({ isSubscriber: true })));
    tts.handleEvent(chat('coucou', user({ isSubscriber: true })));
    await next();
    expect(spoken).toEqual(['Bob dit : coucou']);
  });

  it('reads big gifts only at the end of the streak', async () => {
    const { tts, spoken } = setup({ giftMinDiamonds: 10 });
    const gift = (count: number, final: boolean): LiveEvent => ({
      id: 'g',
      platform: 'simulator',
      timestamp: 0,
      type: 'gift',
      user: user(),
      gift: { id: 'r', name: 'Rose', diamonds: 1 },
      count,
      streakFinal: final,
    });
    tts.handleEvent(gift(20, false));
    tts.handleEvent(gift(5, true));
    tts.handleEvent(gift(10, true));
    expect(spoken).toEqual(['Bob a envoyé 10 Rose, merci !']);
  });

  it('filters profanity and bounds the queue', async () => {
    const { tts, spoken, next } = setup({ readChat: 'all', maxQueue: 2, filterMode: 'censor' });
    for (const t of ['un', 'deux merde', 'trois', 'quatre']) tts.handleEvent(chat(t));
    await next();
    await next();
    await next();
    expect(spoken).toEqual(['Bob dit : un', 'Bob dit : deux bip', 'Bob dit : trois']);
  });

  it('does nothing when disabled', () => {
    const { tts, spoken } = setup({ enabled: false, readChat: 'all' });
    tts.handleEvent(chat('hello'));
    expect(tts.say('hello')).toBe(false);
    expect(spoken).toEqual([]);
  });
});
