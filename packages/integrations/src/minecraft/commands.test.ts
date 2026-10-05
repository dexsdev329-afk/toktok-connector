import { contextFromEvent, EffectSchema, type LiveEvent } from '@toktok/shared';
import { describe, expect, it } from 'vitest';
import {
  buildMinecraftCommands,
  playerTarget,
  renderCommandTemplate,
  safeText,
  type MinecraftEdition,
} from './commands';

const event: LiveEvent = {
  id: 'e',
  platform: 'simulator',
  timestamp: 0,
  type: 'gift',
  user: {
    id: '1',
    username: 'bob_42',
    displayName: 'Bob "l\'ami"',
    isModerator: false,
    isSubscriber: false,
    isFollower: false,
  },
  gift: { id: '5655', name: 'Rose', diamonds: 1 },
  count: 3,
  streakFinal: true,
};
const ctx = contextFromEvent(event);
const fx = (effectId: string, params: Record<string, unknown> = {}) =>
  EffectSchema.parse({ integrationId: 'mc', effectId, params });
// random() = 0 -> angle 0 -> offset (+distance, 0)
const build = (
  edition: MinecraftEdition,
  effectId: string,
  params: Record<string, unknown> = {},
  player = 'Enzo',
) => buildMinecraftCommands(fx(effectId, params), ctx, { edition, player, random: () => 0 });

describe('Minecraft command builder', () => {
  it('summons named mobs per edition', () => {
    expect(build('java', 'mc.summon', { mob: 'zombie', distance: 3 })).toEqual([
      'execute at Enzo run summon zombie ~3 ~ ~ {CustomName:{"text":"bob_42"},CustomNameVisible:1b}',
    ]);
    expect(build('java-legacy', 'mc.summon', { mob: 'creeper', distance: 0 })).toEqual([
      'execute at Enzo run summon creeper ~ ~ ~ {CustomName:\'{"text":"bob_42"}\',CustomNameVisible:1b}',
    ]);
    expect(build('bedrock', 'mc.summon', { mob: 'zombie', distance: 2 }, 'Steve Gamer')).toEqual([
      'execute at "Steve Gamer" run summon zombie "bob_42" ~2 ~ ~',
    ]);
  });

  it('multiplies by gift count when asked, with a cap', () => {
    expect(
      build('java', 'mc.summon', { mob: 'chicken', amount: 2, perGift: true, nameTag: '' }),
    ).toHaveLength(6);
    expect(
      build('java', 'mc.summon', { mob: 'chicken', amount: 50, perGift: true, nameTag: '' }),
    ).toHaveLength(50);
    expect(build('java', 'mc.give', { item: 'diamond', amount: 2, perGift: true })).toEqual([
      'give Enzo diamond 6',
    ]);
  });

  it('rejects unknown mobs, effects and items', () => {
    expect(build('java', 'mc.summon', { mob: 'herobrine; op @a', nameTag: '' })?.[0]).toContain(
      'summon zombie',
    );
    expect(build('java', 'mc.effect', { effect: 'op', seconds: 5, level: 1 })).toEqual([
      'effect give Enzo speed 5 0',
    ]);
    expect(build('java', 'mc.give', { item: 'diamond 64\nop @a' })).toEqual(['give Enzo diamond 1']);
  });

  it('writes potion effects and clears per edition', () => {
    expect(build('java', 'mc.effect', { effect: 'levitation', seconds: 4, level: 2 })).toEqual([
      'effect give Enzo levitation 4 1',
    ]);
    expect(build('bedrock', 'mc.effect', { effect: 'levitation', seconds: 4, level: 2 })).toEqual([
      'effect Enzo levitation 4 1',
    ]);
    expect(build('java', 'mc.clearEffects')).toEqual(['effect clear Enzo']);
    expect(build('bedrock', 'mc.clearEffects')).toEqual(['effect Enzo clear']);
  });

  it('sanitizes titles and sends the subtitle first', () => {
    expect(
      build('java', 'mc.title', { title: '{displayName}', subtitle: '{count}x {giftName}', color: 'red' }),
    ).toEqual([
      'title Enzo subtitle {"text":"3x Rose","color":"white"}',
      'title Enzo title {"text":"Bob lami","color":"red"}',
    ]);
    expect(build('bedrock', 'mc.title', { title: '{displayName}', subtitle: '' })).toEqual([
      'title Enzo title Bob lami',
    ]);
  });

  it('builds TNT rain, lightning, world and cleanup commands', () => {
    expect(build('java', 'mc.tnt', { amount: 2, distance: 4, height: 10 })).toEqual([
      'execute at Enzo run summon tnt ~4 ~10 ~',
      'execute at Enzo run summon tnt ~4 ~10 ~',
    ]);
    expect(build('bedrock', 'mc.lightning', { amount: 1, distance: 0 })).toEqual([
      'execute at Enzo run summon lightning_bolt ~ ~ ~',
    ]);
    expect(build('java', 'mc.weather', { weather: 'thunder' })).toEqual(['weather thunder']);
    expect(build('java', 'mc.time', { time: 'midnight' })).toEqual(['time set midnight']);
    expect(build('java', 'mc.killMobs', { mob: 'zombie', radius: 20 })).toEqual([
      'execute at Enzo run kill @e[type=zombie,distance=..20]',
    ]);
    expect(build('bedrock', 'mc.killMobs', { mob: 'zombie', radius: 20 })).toEqual([
      'execute at Enzo run kill @e[type=zombie,r=20]',
    ]);
  });

  it('targets everyone when no valid player is configured', () => {
    expect(playerTarget('', 'java')).toBe('@a');
    expect(playerTarget('bad name', 'java')).toBe('@a');
    expect(build('java', 'mc.weather', { weather: 'rain' }, '')).toEqual(['weather rain']);
    expect(build('java', 'mc.effect', { effect: 'speed' }, '')).toEqual(['effect give @a speed 15 0']);
  });

  it('returns null for unknown effects', () => {
    expect(build('java', 'mc.nope')).toBeNull();
  });

  it('safeText removes quote and formatting characters', () => {
    expect(safeText('a"b\'c\\d§e\nf')).toBe('abcdef');
  });

  it('renders raw templates per edition', () => {
    expect(
      renderCommandTemplate('/say hi {player}\n# x\nkill {player}', ctx, 'Steve Gamer', 'bedrock'),
    ).toEqual(['say hi "Steve Gamer"', 'kill "Steve Gamer"']);
  });
});

describe('Minecraft starter pack', () => {
  it('only contains valid actions whose effects build commands for both editions', async () => {
    const { ActionSchema } = await import('@toktok/shared');
    const { minecraftStarterPack } = await import('./starter-pack');
    const pack = minecraftStarterPack('mc');
    expect(pack.actions.length).toBeGreaterThan(5);
    for (const a of pack.actions) {
      const action = ActionSchema.parse({ ...a, id: 'x', profileId: 'p' });
      for (const e of action.effects) {
        for (const edition of ['java', 'java-legacy', 'bedrock'] as const) {
          expect(
            buildMinecraftCommands(e, ctx, { edition, player: 'Enzo' })?.length,
            `${a.name} ${e.effectId}`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });
});
