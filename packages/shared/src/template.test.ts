import { describe, expect, it } from 'vitest';
import type { LiveEvent } from './events';
import { contextFromEvent, renderTemplate } from './template';

const user = {
  id: '1',
  username: 'bob',
  displayName: 'Bob "the" builder',
  isModerator: false,
  isSubscriber: false,
  isFollower: false,
};

const gift: LiveEvent = {
  id: 'e1',
  platform: 'simulator',
  timestamp: 0,
  type: 'gift',
  user,
  gift: { id: '5655', name: 'Rose', diamonds: 1 },
  count: 5,
  streakFinal: true,
};

describe('renderTemplate', () => {
  it('replaces known variables and keeps unknown ones', () => {
    const ctx = contextFromEvent(gift);
    expect(renderTemplate('{username} sent {count}x {giftName} ({diamonds}) {nope}', ctx)).toBe(
      'bob sent 5x Rose (5) {nope}',
    );
  });

  it('uses the count override for multiplied executions', () => {
    const ctx = contextFromEvent(gift, 1);
    expect(ctx.count).toBe(1);
    expect(ctx.diamonds).toBe(1);
  });

  it('escapes values for minecraft commands', () => {
    const ctx = contextFromEvent(gift);
    const out = renderTemplate('title @a title {"text":"{displayName}"}', ctx, 'minecraft');
    expect(out).toBe('title @a title {"text":"Bob \\"the\\" builder"}');
  });

  it('neutralises single quotes for SNBT', () => {
    const ctx = { ...contextFromEvent(gift), displayName: "l'ami" };
    expect(renderTemplate("{CustomName:'{displayName}'}", ctx, 'minecraft')).toBe(
      "{CustomName:'l\u2019ami'}",
    );
  });

  it('strips control characters and section signs', () => {
    const ctx = { ...contextFromEvent(gift), message: 'hi\n§cred' };
    expect(renderTemplate('{message}', ctx, 'minecraft')).toBe('hi cred');
  });

  it('url-encodes values', () => {
    const ctx = { ...contextFromEvent(gift), message: 'a b&c' };
    expect(renderTemplate('?m={message}', ctx, 'url')).toBe('?m=a%20b%26c');
  });
});
