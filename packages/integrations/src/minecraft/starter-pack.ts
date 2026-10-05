import type { ActionInput } from '@toktok/shared';

type PackAction = Omit<ActionInput, 'id' | 'profileId'>;

/**
 * Ready-to-use Minecraft profile (works with the Java RCON and Bedrock integrations).
 * Gift tiers use diamond ranges so it works with any gift, without knowing gift ids.
 */
export function minecraftStarterPack(integrationId: string): {
  name: string;
  game: string;
  actions: PackAction[];
} {
  const fx = (effectId: string, params: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    integrationId,
    effectId,
    params,
    ...extra,
  });
  const actions: PackAction[] = [
    {
      name: 'Petit cadeau (1-9 💎) → zombie nommé',
      trigger: { kind: 'diamonds', min: 1, max: 9 },
      quantityMode: 'multiply',
      maxMultiplier: 9,
      effects: [fx('mc.summon', { mob: 'zombie', amount: 1, distance: 4, nameTag: '{username}' })],
    },
    {
      name: 'Cadeau moyen (10-98 💎) → creeper + titre',
      trigger: { kind: 'diamonds', min: 10, max: 98 },
      priority: 6,
      effects: [
        fx('mc.title', { title: '{displayName}', subtitle: '{count}x {giftName}', color: 'green' }),
        fx('mc.summon', { mob: 'creeper', amount: 1, distance: 5, nameTag: '{username}' }, { delayMs: 500 }),
      ],
    },
    {
      name: 'Gros cadeau (99-499 💎) → pluie de TNT',
      trigger: { kind: 'diamonds', min: 99, max: 499 },
      priority: 8,
      effects: [
        fx('mc.title', { title: '{displayName}', subtitle: 'PLUIE DE TNT !', color: 'red' }),
        fx('mc.lightning', { amount: 1, distance: 3 }),
        fx('mc.tnt', { amount: 5, distance: 6, height: 12 }, { delayMs: 800 }),
      ],
    },
    {
      name: 'Énorme cadeau (500+ 💎) → boss',
      trigger: { kind: 'diamonds', min: 500 },
      priority: 10,
      effects: [
        fx('mc.title', { title: '{displayName}', subtitle: 'invoque un boss !', color: 'light_purple' }),
        fx('mc.weather', { weather: 'thunder' }),
        fx('mc.time', { time: 'night' }),
        fx('mc.summon', { mob: 'ravager', amount: 2, distance: 8, nameTag: '{username}' }, { delayMs: 1500 }),
      ],
    },
    {
      name: 'Follow → titre + poulet',
      trigger: { kind: 'follow' },
      userCooldownMs: 300_000,
      effects: [
        fx('mc.title', { title: '{displayName}', subtitle: 'suit le live !', color: 'aqua' }),
        fx('mc.summon', { mob: 'chicken', amount: 1, distance: 2, nameTag: '{username}' }),
      ],
    },
    {
      name: 'Partage → pomme dorée',
      trigger: { kind: 'share' },
      userCooldownMs: 300_000,
      effects: [fx('mc.give', { item: 'golden_apple', amount: 1 })],
    },
    {
      name: 'Tous les 500 likes → vitesse',
      trigger: { kind: 'likes', every: 500 },
      effects: [fx('mc.effect', { effect: 'speed', seconds: 20, level: 2 })],
    },
    {
      name: '!heal → soin (cooldown 60 s)',
      trigger: { kind: 'command', name: 'heal' },
      cooldownMs: 60_000,
      effects: [fx('mc.effect', { effect: 'instant_health', seconds: 1, level: 3 })],
    },
    {
      name: '!nuit (modérateurs) → nuit',
      trigger: { kind: 'command', name: 'nuit' },
      userFilter: {
        moderatorsOnly: true,
        subscribersOnly: false,
        followersOnly: false,
        allowList: [],
        denyList: [],
      },
      effects: [fx('mc.time', { time: 'night' })],
    },
  ];
  return {
    name: 'Minecraft — pack de départ',
    game: 'Minecraft',
    actions: actions.map((a, i) => ({ ...a, position: i })),
  };
}
