/**
 * Structured Minecraft effects -> commands, for Java (RCON) and Bedrock (/connect).
 *
 * Syntax notes (checked on minecraft.wiki, Oct 2026):
 * - Java /summon <entity> [pos] [nbt]; Bedrock /summon <entity> <nameTag> [pos]
 * - Java 1.21.5+ writes text components (CustomName...) as SNBT; 1.13-1.21.4 as JSON strings.
 * - /title and /tellraw accept {"text":...} objects in every Java version (valid JSON and SNBT).
 * - Java: effect give <t> <effect> [s] [amp] / effect clear <t>; Bedrock: effect <t> <effect> [s] [amp] / effect <t> clear
 * - Bedrock /title takes plain text.
 */
import { renderTemplate, type Effect, type TemplateContext } from '@toktok/shared';
import { numberParam, stringParam, type EffectDefinition, type EffectPreset } from '../sdk';

export type MinecraftEdition = 'java' | 'java-legacy' | 'bedrock';

export const MOBS = [
  // hostile
  'zombie',
  'husk',
  'drowned',
  'skeleton',
  'stray',
  'creeper',
  'spider',
  'cave_spider',
  'enderman',
  'witch',
  'slime',
  'magma_cube',
  'phantom',
  'blaze',
  'wither_skeleton',
  'pillager',
  'vindicator',
  'evoker',
  'ravager',
  'silverfish',
  'zombified_piglin',
  'piglin_brute',
  'hoglin',
  'warden',
  // friendly / neutral
  'chicken',
  'cow',
  'pig',
  'sheep',
  'rabbit',
  'wolf',
  'cat',
  'fox',
  'parrot',
  'bee',
  'axolotl',
  'goat',
  'frog',
  'horse',
  'llama',
  'panda',
  'polar_bear',
  'villager',
  'iron_golem',
  'snow_golem',
  'allay',
  'camel',
  'armadillo',
] as const;

export const POTION_EFFECTS = [
  'speed',
  'slowness',
  'haste',
  'mining_fatigue',
  'strength',
  'instant_health',
  'instant_damage',
  'jump_boost',
  'nausea',
  'regeneration',
  'resistance',
  'fire_resistance',
  'water_breathing',
  'invisibility',
  'blindness',
  'night_vision',
  'hunger',
  'weakness',
  'poison',
  'wither',
  'levitation',
  'slow_falling',
  'darkness',
  'glowing',
] as const;

export const ITEMS = [
  'diamond',
  'emerald',
  'iron_ingot',
  'gold_ingot',
  'netherite_ingot',
  'golden_apple',
  'enchanted_golden_apple',
  'cooked_beef',
  'bread',
  'cake',
  'totem_of_undying',
  'ender_pearl',
  'arrow',
  'tnt',
  'diamond_sword',
  'diamond_pickaxe',
  'bow',
  'shield',
  'oak_log',
  'cobblestone',
  'torch',
  'bucket',
  'water_bucket',
  'dirt',
] as const;

const opts = (list: readonly string[]) => list.map((v) => ({ value: v, label: v }));

export const MINECRAFT_EFFECTS: EffectDefinition[] = [
  {
    id: 'mc.summon',
    name: 'Faire apparaître un mob',
    description: 'Apparaît autour du joueur, nommé avec le pseudo du viewer.',
    params: [
      { key: 'mob', label: 'mc.mob', type: 'select', default: 'zombie', options: opts(MOBS) },
      { key: 'amount', label: 'mc.amount', type: 'number', default: 1, min: 1, max: 50 },
      { key: 'perGift', label: 'mc.perGift', type: 'boolean', default: false },
      { key: 'distance', label: 'mc.distance', type: 'number', default: 3, min: 0, max: 30 },
      { key: 'nameTag', label: 'mc.nameTag', type: 'string', default: '{username}' },
    ],
  },
  {
    id: 'mc.tnt',
    name: 'TNT',
    description: 'TNT allumée autour du joueur (pluie si quantité > 1).',
    params: [
      { key: 'amount', label: 'mc.amount', type: 'number', default: 1, min: 1, max: 30 },
      { key: 'perGift', label: 'mc.perGift', type: 'boolean', default: false },
      { key: 'distance', label: 'mc.distance', type: 'number', default: 3, min: 0, max: 30 },
      { key: 'height', label: 'mc.height', type: 'number', default: 3, min: 0, max: 40 },
    ],
  },
  {
    id: 'mc.lightning',
    name: 'Éclair',
    params: [
      { key: 'amount', label: 'mc.amount', type: 'number', default: 1, min: 1, max: 10 },
      { key: 'distance', label: 'mc.distance', type: 'number', default: 2, min: 0, max: 30 },
    ],
  },
  {
    id: 'mc.effect',
    name: 'Effet de potion',
    params: [
      { key: 'effect', label: 'mc.potion', type: 'select', default: 'speed', options: opts(POTION_EFFECTS) },
      { key: 'seconds', label: 'mc.seconds', type: 'number', default: 15, min: 1, max: 3600 },
      { key: 'level', label: 'mc.level', type: 'number', default: 1, min: 1, max: 10 },
    ],
  },
  { id: 'mc.clearEffects', name: 'Retirer tous les effets', params: [] },
  {
    id: 'mc.give',
    name: 'Donner un objet',
    params: [
      { key: 'item', label: 'mc.item', type: 'select', default: 'diamond', options: opts(ITEMS) },
      { key: 'amount', label: 'mc.amount', type: 'number', default: 1, min: 1, max: 64 },
      { key: 'perGift', label: 'mc.perGift', type: 'boolean', default: false },
    ],
  },
  {
    id: 'mc.title',
    name: 'Titre à l’écran',
    params: [
      { key: 'title', label: 'mc.titleText', type: 'string', default: '{displayName}' },
      { key: 'subtitle', label: 'mc.subtitleText', type: 'string', default: '{count}x {giftName}' },
      {
        key: 'color',
        label: 'mc.color',
        type: 'select',
        default: 'gold',
        options: opts(['white', 'gold', 'yellow', 'red', 'aqua', 'green', 'light_purple', 'blue']),
      },
    ],
  },
  {
    id: 'mc.say',
    name: 'Message dans le chat du jeu',
    params: [{ key: 'text', label: 'mc.message', type: 'string', default: '[LIVE] {displayName} : merci !' }],
  },
  {
    id: 'mc.weather',
    name: 'Météo',
    params: [
      {
        key: 'weather',
        label: 'mc.weather',
        type: 'select',
        default: 'rain',
        options: opts(['clear', 'rain', 'thunder']),
      },
    ],
  },
  {
    id: 'mc.time',
    name: 'Heure du jour',
    params: [
      {
        key: 'time',
        label: 'mc.time',
        type: 'select',
        default: 'night',
        options: opts(['day', 'noon', 'night', 'midnight']),
      },
    ],
  },
  {
    id: 'mc.killMobs',
    name: 'Supprimer les mobs autour',
    params: [
      { key: 'mob', label: 'mc.mob', type: 'select', default: 'zombie', options: opts(MOBS) },
      { key: 'radius', label: 'mc.radius', type: 'number', default: 30, min: 1, max: 200 },
    ],
  },
];

/** Raw command effect (one per line, with variables). */
export function rawCommandEffect(id: string): EffectDefinition {
  return {
    id,
    name: 'Commande Minecraft',
    description:
      'Une commande par ligne. Variables : {player} {username} {displayName} {giftName} {count} {diamonds} {message}',
    params: [
      { key: 'command', label: 'effects.command', type: 'text', placeholder: 'say Merci {displayName} !' },
    ],
  };
}

export const MINECRAFT_PRESETS: EffectPreset[] = [
  {
    id: 'mc.p.zombie',
    name: 'Zombie nommé',
    category: 'Mobs',
    effectId: 'mc.summon',
    params: { mob: 'zombie', amount: 1, distance: 3, nameTag: '{username}' },
  },
  {
    id: 'mc.p.creeper',
    name: 'Creeper',
    category: 'Mobs',
    effectId: 'mc.summon',
    params: { mob: 'creeper', amount: 1, distance: 4, nameTag: '{username}' },
  },
  {
    id: 'mc.p.horde',
    name: 'Horde (1 zombie par cadeau)',
    category: 'Mobs',
    effectId: 'mc.summon',
    params: { mob: 'zombie', amount: 1, perGift: true, distance: 5, nameTag: '{username}' },
  },
  {
    id: 'mc.p.chickens',
    name: 'Pluie de poulets',
    category: 'Mobs',
    effectId: 'mc.summon',
    params: { mob: 'chicken', amount: 10, distance: 4, nameTag: '' },
  },
  {
    id: 'mc.p.wolf',
    name: 'Loup allié',
    category: 'Mobs',
    effectId: 'mc.summon',
    params: { mob: 'wolf', amount: 1, distance: 1, nameTag: '{username}' },
  },
  {
    id: 'mc.p.golem',
    name: 'Golem de fer',
    category: 'Mobs',
    effectId: 'mc.summon',
    params: { mob: 'iron_golem', amount: 1, distance: 3, nameTag: '{username}' },
  },
  {
    id: 'mc.p.warden',
    name: 'Warden (!)',
    category: 'Mobs',
    effectId: 'mc.summon',
    params: { mob: 'warden', amount: 1, distance: 8, nameTag: '{username}' },
  },
  {
    id: 'mc.p.tnt',
    name: 'TNT',
    category: 'TNT',
    effectId: 'mc.tnt',
    params: { amount: 1, distance: 2, height: 3 },
  },
  {
    id: 'mc.p.tnt-rain',
    name: 'Pluie de TNT (x5)',
    category: 'TNT',
    effectId: 'mc.tnt',
    params: { amount: 5, distance: 6, height: 12 },
  },
  {
    id: 'mc.p.lightning',
    name: 'Éclair',
    category: 'Monde',
    effectId: 'mc.lightning',
    params: { amount: 1, distance: 2 },
  },
  {
    id: 'mc.p.storm',
    name: 'Orage',
    category: 'Monde',
    effectId: 'mc.weather',
    params: { weather: 'thunder' },
  },
  {
    id: 'mc.p.clear',
    name: 'Beau temps',
    category: 'Monde',
    effectId: 'mc.weather',
    params: { weather: 'clear' },
  },
  { id: 'mc.p.night', name: 'Nuit', category: 'Monde', effectId: 'mc.time', params: { time: 'night' } },
  { id: 'mc.p.day', name: 'Jour', category: 'Monde', effectId: 'mc.time', params: { time: 'day' } },
  {
    id: 'mc.p.speed',
    name: 'Vitesse 30 s',
    category: 'Effets',
    effectId: 'mc.effect',
    params: { effect: 'speed', seconds: 30, level: 2 },
  },
  {
    id: 'mc.p.slow',
    name: 'Lenteur 20 s',
    category: 'Effets',
    effectId: 'mc.effect',
    params: { effect: 'slowness', seconds: 20, level: 2 },
  },
  {
    id: 'mc.p.blind',
    name: 'Cécité 10 s',
    category: 'Effets',
    effectId: 'mc.effect',
    params: { effect: 'blindness', seconds: 10, level: 1 },
  },
  {
    id: 'mc.p.levitate',
    name: 'Lévitation 4 s',
    category: 'Effets',
    effectId: 'mc.effect',
    params: { effect: 'levitation', seconds: 4, level: 2 },
  },
  {
    id: 'mc.p.heal',
    name: 'Soin complet',
    category: 'Effets',
    effectId: 'mc.effect',
    params: { effect: 'instant_health', seconds: 1, level: 5 },
  },
  { id: 'mc.p.cleanse', name: 'Purifier', category: 'Effets', effectId: 'mc.clearEffects', params: {} },
  {
    id: 'mc.p.diamond',
    name: 'Diamant par cadeau',
    category: 'Objets',
    effectId: 'mc.give',
    params: { item: 'diamond', amount: 1, perGift: true },
  },
  {
    id: 'mc.p.apple',
    name: 'Pomme dorée',
    category: 'Objets',
    effectId: 'mc.give',
    params: { item: 'golden_apple', amount: 1 },
  },
  {
    id: 'mc.p.totem',
    name: 'Totem d’immortalité',
    category: 'Objets',
    effectId: 'mc.give',
    params: { item: 'totem_of_undying', amount: 1 },
  },
  {
    id: 'mc.p.title-gift',
    name: 'Titre : merci pour le cadeau',
    category: 'Messages',
    effectId: 'mc.title',
    params: { title: '{displayName}', subtitle: '{count}x {giftName}', color: 'gold' },
  },
  {
    id: 'mc.p.title-follow',
    name: 'Titre : nouveau follower',
    category: 'Messages',
    effectId: 'mc.title',
    params: { title: '{displayName}', subtitle: 'suit le live !', color: 'aqua' },
  },
  {
    id: 'mc.p.say',
    name: 'Message dans le chat',
    category: 'Messages',
    effectId: 'mc.say',
    params: { text: '[LIVE] {displayName} : {message}' },
  },
  {
    id: 'mc.p.kill-zombies',
    name: 'Nettoyer les zombies',
    category: 'Monde',
    effectId: 'mc.killMobs',
    params: { mob: 'zombie', radius: 40 },
  },
];

const SAFE_ID = /^[a-z0-9_]+$/;

/**
 * Text that ends up inside quotes in a command: strips everything that could
 * break out of a string or inject formatting (quotes, backslashes, §, control chars).
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\u0000-\u001f\u007f"'\\§]/g;

export function safeText(s: string, max = 80): string {
  return s.replace(UNSAFE_TEXT, '').trim().slice(0, max);
}

/** Player target: a name (validated) or @a. Bedrock names with spaces must be quoted. */
export function playerTarget(player: string, edition: MinecraftEdition): string {
  const p = player.trim();
  if (!p) return '@a';
  if (edition === 'bedrock') {
    const clean = safeText(p, 32);
    return /\s/.test(clean) ? `"${clean}"` : clean;
  }
  return /^[A-Za-z0-9_]{1,16}$/.test(p) ? p : '@a';
}

function bool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1;
}

function pick<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Deterministic-friendly random offset on a circle of radius `distance`. */
function offset(distance: number, random: () => number): string {
  if (distance <= 0) return '~ ~ ~';
  const a = random() * Math.PI * 2;
  const dx = Math.round(Math.cos(a) * distance);
  const dz = Math.round(Math.sin(a) * distance);
  return `~${dx || ''} ~ ~${dz || ''}`;
}

function amountFor(effect: Effect, ctx: TemplateContext, max: number): number {
  const base = numberParam(effect, 'amount', 1, 1, max);
  const total = bool(effect.params.perGift) ? base * Math.max(1, ctx.count) : base;
  return Math.min(max, Math.max(1, Math.floor(total)));
}

function nameTagFor(edition: MinecraftEdition, name: string): string {
  if (!name) return '';
  return edition === 'java'
    ? `{CustomName:{"text":"${name}"},CustomNameVisible:1b}`
    : `{CustomName:'{"text":"${name}"}',CustomNameVisible:1b}`;
}

export interface BuildOptions {
  edition: MinecraftEdition;
  player: string;
  random?: () => number;
}

/**
 * Builds the commands of a structured effect. Returns null for unknown effect ids.
 * Every user-controlled value is validated against a list or sanitized.
 */
export function buildMinecraftCommands(
  effect: Effect,
  ctx: TemplateContext,
  o: BuildOptions,
): string[] | null {
  const random = o.random ?? Math.random;
  const target = playerTarget(o.player, o.edition);
  const at = (cmd: string) => `execute at ${target} run ${cmd}`;
  const text = (key: string, fallback: string) =>
    safeText(renderTemplate(stringParam(effect, key, fallback), ctx));
  const bedrock = o.edition === 'bedrock';

  switch (effect.effectId) {
    case 'mc.summon': {
      const mob = pick(stringParam(effect, 'mob', 'zombie'), MOBS, 'zombie');
      const n = amountFor(effect, ctx, 50);
      const distance = numberParam(effect, 'distance', 3, 0, 30);
      const name = text('nameTag', '{username}');
      return Array.from({ length: n }, () => {
        const pos = offset(distance, random);
        if (bedrock) return at(name ? `summon ${mob} "${name}" ${pos}` : `summon ${mob} ${pos}`);
        return at(`summon ${mob} ${pos}${name ? ' ' + nameTagFor(o.edition, name) : ''}`);
      });
    }
    case 'mc.tnt': {
      const n = amountFor(effect, ctx, 30);
      const distance = numberParam(effect, 'distance', 3, 0, 30);
      const height = Math.round(numberParam(effect, 'height', 3, 0, 40));
      return Array.from({ length: n }, () => {
        const [x, , z] = offset(distance, random).split(' ');
        return at(`summon tnt ${x} ~${height || ''} ${z}`);
      });
    }
    case 'mc.lightning': {
      const n = Math.round(numberParam(effect, 'amount', 1, 1, 10));
      const distance = numberParam(effect, 'distance', 2, 0, 30);
      return Array.from({ length: n }, () => at(`summon lightning_bolt ${offset(distance, random)}`));
    }
    case 'mc.effect': {
      const id = pick(stringParam(effect, 'effect', 'speed'), POTION_EFFECTS, 'speed');
      const seconds = Math.round(numberParam(effect, 'seconds', 15, 1, 3600));
      const amp = Math.round(numberParam(effect, 'level', 1, 1, 10)) - 1;
      return [
        bedrock
          ? `effect ${target} ${id} ${seconds} ${amp}`
          : `effect give ${target} ${id} ${seconds} ${amp}`,
      ];
    }
    case 'mc.clearEffects':
      return [bedrock ? `effect ${target} clear` : `effect clear ${target}`];
    case 'mc.give': {
      const raw = stringParam(effect, 'item', 'diamond');
      const item = SAFE_ID.test(raw) ? raw : 'diamond';
      return [`give ${target} ${item} ${amountFor(effect, ctx, 64)}`];
    }
    case 'mc.title': {
      const title = text('title', '{displayName}');
      const subtitle = text('subtitle', '');
      const color = pick(
        stringParam(effect, 'color', 'gold'),
        ['white', 'gold', 'yellow', 'red', 'aqua', 'green', 'light_purple', 'blue'],
        'gold',
      );
      const cmds: string[] = [];
      // The subtitle is displayed together with the next title, so it is sent first.
      if (bedrock) {
        if (subtitle) cmds.push(`title ${target} subtitle ${subtitle}`);
        cmds.push(`title ${target} title ${title || ' '}`);
      } else {
        if (subtitle) cmds.push(`title ${target} subtitle {"text":"${subtitle}","color":"white"}`);
        cmds.push(`title ${target} title {"text":"${title}","color":"${color}"}`);
      }
      return cmds;
    }
    case 'mc.say': {
      const msg = text('text', '');
      if (!msg) return [];
      return bedrock ? [`say ${msg}`] : [`tellraw @a {"text":"${msg}","color":"light_purple"}`];
    }
    case 'mc.weather':
      return [
        `weather ${pick(stringParam(effect, 'weather', 'rain'), ['clear', 'rain', 'thunder'], 'rain')}`,
      ];
    case 'mc.time':
      return [
        `time set ${pick(stringParam(effect, 'time', 'night'), ['day', 'noon', 'night', 'midnight'], 'night')}`,
      ];
    case 'mc.killMobs': {
      const mob = pick(stringParam(effect, 'mob', 'zombie'), MOBS, 'zombie');
      const r = Math.round(numberParam(effect, 'radius', 30, 1, 200));
      return [at(bedrock ? `kill @e[type=${mob},r=${r}]` : `kill @e[type=${mob},distance=..${r}]`)];
    }
    default:
      return null;
  }
}

/** Raw command template -> commands (one per line, comments with #, max 20). */
export function renderCommandTemplate(
  template: string,
  ctx: TemplateContext,
  player: string,
  edition: MinecraftEdition,
): string[] {
  const target = playerTarget(player, edition);
  return template
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => renderTemplate(line.replaceAll('{player}', target), ctx, 'minecraft'))
    .map((line) => line.replace(/^\//, ''))
    .slice(0, 20);
}
