import type { Effect, TemplateContext } from '@toktok/shared';
import { z } from 'zod';
import {
  IntegrationError,
  stringParam,
  type Integration,
  type IntegrationDefinition,
  type IntegrationDeps,
  type IntegrationStatus,
} from '../sdk';

export type ControllerType = 'x360' | 'ds4';

/** Native virtual controller (ViGEmBus through vigemclient in the desktop app). */
export interface VirtualController {
  setButton(name: string, pressed: boolean): void;
  /** Sticks -1..1, triggers 0..1, dpadHorz/dpadVert -1|0|1. */
  setAxis(name: string, value: number): void;
  reset(): void;
  disconnect(): void;
}

export interface GamepadDriver {
  createController(type: ControllerType): VirtualController;
}

/** Friendly names -> native button names of each controller type. */
const BUTTONS: Record<ControllerType, Record<string, string>> = {
  x360: {
    a: 'A',
    b: 'B',
    x: 'X',
    y: 'Y',
    lb: 'LEFT_SHOULDER',
    rb: 'RIGHT_SHOULDER',
    ls: 'LEFT_THUMB',
    rs: 'RIGHT_THUMB',
    start: 'START',
    back: 'BACK',
    guide: 'GUIDE',
  },
  ds4: {
    cross: 'CROSS',
    circle: 'CIRCLE',
    square: 'SQUARE',
    triangle: 'TRIANGLE',
    a: 'CROSS',
    b: 'CIRCLE',
    x: 'SQUARE',
    y: 'TRIANGLE',
    l1: 'SHOULDER_LEFT',
    r1: 'SHOULDER_RIGHT',
    lb: 'SHOULDER_LEFT',
    rb: 'SHOULDER_RIGHT',
    l3: 'THUMB_LEFT',
    r3: 'THUMB_RIGHT',
    ls: 'THUMB_LEFT',
    rs: 'THUMB_RIGHT',
    options: 'OPTIONS',
    start: 'OPTIONS',
    share: 'SHARE',
    back: 'SHARE',
    ps: 'SPECIAL_PS',
    guide: 'SPECIAL_PS',
    touchpad: 'SPECIAL_TOUCHPAD',
  },
};

const DPAD: Record<string, [string, number]> = {
  up: ['dpadVert', 1],
  down: ['dpadVert', -1],
  left: ['dpadHorz', -1],
  right: ['dpadHorz', 1],
};

export type PadStep =
  | { op: 'press'; button: string; ms: number }
  | { op: 'down' | 'up'; button: string }
  | { op: 'stick'; side: 'left' | 'right'; x: number; y: number; ms: number }
  | { op: 'trigger'; side: 'left' | 'right'; value: number; ms: number }
  | { op: 'dpad'; dir: keyof typeof DPAD; ms: number }
  | { op: 'wait'; ms: number };

const MAX_MS = 30_000;

/**
 * press a 200 · down a · up a · stick left 0 1 800 · trigger right 1 500 · dpad up 150 · wait 300
 */
export function parsePadScript(source: string, type: ControllerType): PadStep[] {
  const steps: PadStep[] = [];
  const names = BUTTONS[type];
  source.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    const [cmd, ...args] = line.toLowerCase().split(/\s+/);
    const fail = (msg: string): never => {
      throw new IntegrationError(`Ligne ${i + 1} : ${msg}`);
    };
    const ms = (raw: string | undefined, def: number) => {
      if (raw === undefined) return def;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > MAX_MS) fail('durée invalide (0 à 30000 ms)');
      return n;
    };
    const num = (raw: string | undefined, min: number, max: number) => {
      const n = Number(raw);
      if (raw === undefined || !Number.isFinite(n) || n < min || n > max)
        fail(`valeur entre ${min} et ${max} attendue`);
      return n;
    };
    const button = (raw: string | undefined) => {
      const b = raw ? names[raw] : undefined;
      if (!b) fail(`bouton inconnu « ${raw ?? ''} » (${Object.keys(names).join(', ')})`);
      return b!;
    };
    const side = (raw: string | undefined): 'left' | 'right' =>
      raw === 'left' || raw === 'right' ? raw : fail('« left » ou « right » attendu');
    switch (cmd) {
      case 'press':
        steps.push({ op: 'press', button: button(args[0]), ms: ms(args[1], 120) });
        break;
      case 'down':
      case 'up':
        steps.push({ op: cmd, button: button(args[0]) });
        break;
      case 'stick':
        steps.push({
          op: 'stick',
          side: side(args[0]),
          x: num(args[1], -1, 1),
          y: num(args[2], -1, 1),
          ms: ms(args[3], 500),
        });
        break;
      case 'trigger':
        steps.push({ op: 'trigger', side: side(args[0]), value: num(args[1], 0, 1), ms: ms(args[2], 300) });
        break;
      case 'dpad': {
        const dir = args[0] ?? '';
        if (!(dir in DPAD)) fail('direction : up, down, left, right');
        steps.push({ op: 'dpad', dir: dir as keyof typeof DPAD, ms: ms(args[1], 150) });
        break;
      }
      case 'wait':
        steps.push({ op: 'wait', ms: ms(args[0], 100) });
        break;
      default:
        fail(`commande inconnue « ${cmd} »`);
    }
    if (steps.length > 200) fail('trop d’étapes (200 max)');
  });
  return steps;
}

export const GamepadConfigSchema = z.object({
  controller: z.enum(['x360', 'ds4']).default('x360'),
});
export type GamepadConfig = z.infer<typeof GamepadConfigSchema>;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Virtual Xbox 360 / DualShock 4 controller driven by scripts. Sequences never overlap. */
export class GamepadIntegration implements Integration {
  private pad: VirtualController | null = null;
  private chain: Promise<void> = Promise.resolve();
  private state: IntegrationStatus;

  constructor(
    private readonly config: GamepadConfig,
    private readonly driver: GamepadDriver | undefined,
  ) {
    this.state = driver
      ? { state: 'disconnected' }
      : { state: 'error', detail: 'ViGEmBus introuvable : installe le pilote ViGEmBus 1.22 (Windows)' };
  }

  status(): IntegrationStatus {
    return this.state;
  }

  listEffects() {
    return gamepadDefinition.effects;
  }

  async connect(): Promise<void> {
    if (this.pad) return;
    if (!this.driver) throw new IntegrationError(this.state.detail ?? 'indisponible');
    try {
      this.pad = this.driver.createController(this.config.controller);
      this.state = {
        state: 'connected',
        detail:
          this.config.controller === 'x360' ? 'Manette Xbox 360 branchée' : 'Manette DualShock 4 branchée',
      };
    } catch (err) {
      this.state = { state: 'error', detail: err instanceof Error ? err.message : String(err) };
      throw new IntegrationError(`Manette virtuelle : ${this.state.detail}`);
    }
  }

  async disconnect(): Promise<void> {
    this.pad?.disconnect();
    this.pad = null;
    if (this.driver) this.state = { state: 'disconnected' };
  }

  execute(effect: Effect, _ctx: TemplateContext, signal: AbortSignal): Promise<void> {
    let script: string;
    if (effect.effectId === 'pad.sequence') script = stringParam(effect, 'script');
    else if (effect.effectId === 'pad.press')
      script = `press ${stringParam(effect, 'button', 'a')} ${stringParam(effect, 'ms', '120')}`;
    else return Promise.reject(new IntegrationError(`Effet inconnu: ${effect.effectId}`));
    let steps: PadStep[];
    try {
      steps = parsePadScript(script, this.config.controller);
    } catch (err) {
      return Promise.reject(err);
    }
    const run = this.chain.then(async () => {
      await this.connect();
      await this.run(this.pad!, steps, signal);
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async run(pad: VirtualController, steps: PadStep[], signal: AbortSignal): Promise<void> {
    try {
      for (const s of steps) {
        if (signal.aborted) throw new Error('aborted');
        switch (s.op) {
          case 'press':
            pad.setButton(s.button, true);
            await sleep(s.ms, signal);
            pad.setButton(s.button, false);
            break;
          case 'down':
          case 'up':
            pad.setButton(s.button, s.op === 'down');
            break;
          case 'stick':
            pad.setAxis(`${s.side}X`, s.x);
            pad.setAxis(`${s.side}Y`, s.y);
            await sleep(s.ms, signal);
            pad.setAxis(`${s.side}X`, 0);
            pad.setAxis(`${s.side}Y`, 0);
            break;
          case 'trigger':
            pad.setAxis(`${s.side}Trigger`, s.value);
            await sleep(s.ms, signal);
            pad.setAxis(`${s.side}Trigger`, 0);
            break;
          case 'dpad': {
            const [axis, value] = DPAD[s.dir]!;
            pad.setAxis(axis, value);
            await sleep(s.ms, signal);
            pad.setAxis(axis, 0);
            break;
          }
          case 'wait':
            await sleep(s.ms, signal);
            break;
        }
      }
    } finally {
      // Never leave a button held or a stick pushed.
      pad.reset();
    }
  }
}

export const gamepadDefinition: IntegrationDefinition<GamepadConfig> = {
  kind: 'gamepad',
  name: 'Manette virtuelle (ViGEmBus)',
  description:
    'Crée une manette Xbox 360 ou DualShock 4 virtuelle (Windows, pilote ViGEmBus à installer soi-même) pour piloter un jeu PC ou en Remote Play.',
  configFields: [
    {
      key: 'controller',
      label: 'integrations.gamepad.controller',
      type: 'select',
      default: 'x360',
      options: [
        { value: 'x360', label: 'Xbox 360' },
        { value: 'ds4', label: 'DualShock 4' },
      ],
    },
  ],
  configSchema: GamepadConfigSchema,
  effects: [
    {
      id: 'pad.sequence',
      name: 'Séquence manette',
      description:
        'press a 200 · down a · up a · stick left 0 1 800 · trigger right 1 500 · dpad up 150 · wait 300',
      params: [
        {
          key: 'script',
          label: 'effects.script',
          type: 'text',
          placeholder: 'stick left 0 1 1500\npress a 150',
        },
      ],
    },
    {
      id: 'pad.press',
      name: 'Appuyer sur un bouton',
      params: [
        {
          key: 'button',
          label: 'gamepad.button',
          type: 'string',
          default: 'a',
          placeholder: 'a, b, x, y, lb, rb, start…',
        },
        { key: 'ms', label: 'effects.durationMs', type: 'number', default: 120, min: 0, max: 30_000 },
      ],
    },
  ],
  presets: [
    {
      id: 'pad.jump',
      name: 'Sauter (A)',
      category: 'Manette',
      effectId: 'pad.press',
      params: { button: 'a', ms: 120 },
    },
    {
      id: 'pad.forward',
      name: 'Avancer 1,5 s',
      category: 'Manette',
      effectId: 'pad.sequence',
      params: { script: 'stick left 0 1 1500' },
    },
    {
      id: 'pad.spin',
      name: 'Tourner la caméra',
      category: 'Manette',
      effectId: 'pad.sequence',
      params: { script: 'stick right 1 0 700' },
    },
    {
      id: 'pad.shoot',
      name: 'Tirer (gâchette droite)',
      category: 'Manette',
      effectId: 'pad.sequence',
      params: { script: 'trigger right 1 400' },
    },
    {
      id: 'pad.pause',
      name: 'Pause (Start)',
      category: 'Manette',
      effectId: 'pad.press',
      params: { button: 'start', ms: 100 },
    },
  ],
  create: (config, deps: IntegrationDeps) => new GamepadIntegration(config, deps.gamepad),
};
