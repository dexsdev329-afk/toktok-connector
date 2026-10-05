import type { Effect, TemplateContext } from '@toktok/shared';
import { z } from 'zod';
import {
  IntegrationError,
  numberParam,
  stringParam,
  type Integration,
  type IntegrationDefinition,
  type IntegrationDeps,
  type IntegrationStatus,
} from '../sdk';
import type { InputDriver, MouseButton } from './driver';
import { parseInputScript, type InputStep } from './script';

export const InputConfigSchema = z.object({
  /** Global pause between two steps (ms), some games miss too-fast inputs. */
  stepDelayMs: z.coerce.number().int().min(0).max(1000).default(30),
});
export type InputConfig = z.infer<typeof InputConfigSchema>;

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

/**
 * Keyboard/mouse simulation. Sequences never interleave (mutex) and every key or
 * button still held is released when a sequence ends, fails or is cancelled.
 */
export class InputIntegration implements Integration {
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: InputConfig,
    private readonly driver: InputDriver | undefined,
  ) {}

  status(): IntegrationStatus {
    return this.driver
      ? { state: 'connected' }
      : { state: 'error', detail: 'Module de simulation clavier indisponible sur ce système' };
  }

  listEffects() {
    return inputDefinition.effects;
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  execute(effect: Effect, _ctx: TemplateContext, signal: AbortSignal): Promise<void> {
    const driver = this.driver;
    if (!driver) return Promise.reject(new IntegrationError(this.status().detail ?? 'indisponible'));
    const steps = this.stepsFor(effect);
    const run = this.chain.then(() => this.run(driver, steps, signal));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private stepsFor(effect: Effect): InputStep[] {
    switch (effect.effectId) {
      case 'input.sequence':
        return parseInputScript(stringParam(effect, 'script'));
      case 'input.tap':
        return parseInputScript(`tap ${stringParam(effect, 'key')}`);
      case 'input.hold':
        return parseInputScript(
          `hold ${stringParam(effect, 'key')} ${numberParam(effect, 'ms', 1000, 1, 60_000)}`,
        );
      default:
        throw new IntegrationError(`Effet inconnu: ${effect.effectId}`);
    }
  }

  private async run(driver: InputDriver, steps: InputStep[], signal: AbortSignal): Promise<void> {
    const heldKeys = new Map<string, string[]>();
    const heldButtons = new Set<MouseButton>();
    try {
      for (const step of steps) {
        if (signal.aborted) throw new Error('aborted');
        switch (step.op) {
          case 'tap':
            driver.keyTap(step.key, step.modifiers);
            break;
          case 'hold':
            driver.keyToggle(step.key, true, step.modifiers);
            heldKeys.set(step.key, step.modifiers);
            await sleep(step.ms, signal);
            driver.keyToggle(step.key, false, step.modifiers);
            heldKeys.delete(step.key);
            break;
          case 'down':
            driver.keyToggle(step.key, true, step.modifiers);
            heldKeys.set(step.key, step.modifiers);
            break;
          case 'up':
            driver.keyToggle(step.key, false, step.modifiers);
            heldKeys.delete(step.key);
            break;
          case 'wait':
            await sleep(step.ms, signal);
            break;
          case 'type':
            driver.typeString(step.text);
            break;
          case 'click':
            driver.mouseClick(step.button, step.double);
            break;
          case 'mousedown':
            driver.mouseToggle(step.button, true);
            heldButtons.add(step.button);
            break;
          case 'mouseup':
            driver.mouseToggle(step.button, false);
            heldButtons.delete(step.button);
            break;
          case 'move':
            driver.moveMouse(step.x, step.y);
            break;
          case 'moveby':
            driver.moveMouseRelative(step.x, step.y);
            break;
          case 'scroll':
            driver.scrollMouse(step.x, step.y);
            break;
        }
        if (this.config.stepDelayMs > 0 && step.op !== 'wait') await sleep(this.config.stepDelayMs, signal);
      }
    } finally {
      for (const [key, mods] of heldKeys) driver.keyToggle(key, false, mods);
      for (const b of heldButtons) driver.mouseToggle(b, false);
    }
  }
}

export const inputDefinition: IntegrationDefinition<InputConfig> = {
  kind: 'input',
  name: 'Clavier & souris',
  description: 'Simule des touches et la souris dans le jeu au premier plan.',
  configFields: [
    {
      key: 'stepDelayMs',
      label: 'integrations.input.stepDelay',
      type: 'number',
      default: 30,
      min: 0,
      max: 1000,
    },
  ],
  configSchema: InputConfigSchema,
  effects: [
    {
      id: 'input.sequence',
      name: 'Séquence de touches',
      description: 'tap / hold / down / up / wait / type / click / move / moveby / scroll',
      params: [
        {
          key: 'script',
          label: 'effects.script',
          type: 'text',
          placeholder: 'hold w 1500\ntap space\nwait 200\nclick left',
        },
      ],
    },
    {
      id: 'input.tap',
      name: 'Appuyer sur une touche',
      params: [{ key: 'key', label: 'effects.key', type: 'string', placeholder: 'space, ctrl+s, f5…' }],
    },
    {
      id: 'input.hold',
      name: 'Maintenir une touche',
      params: [
        { key: 'key', label: 'effects.key', type: 'string', placeholder: 'w' },
        { key: 'ms', label: 'effects.durationMs', type: 'number', default: 1000, min: 1, max: 60_000 },
      ],
    },
  ],
  presets: [
    { id: 'in.jump', name: 'Sauter', category: 'moves', effectId: 'input.tap', params: { key: 'space' } },
    {
      id: 'in.forward',
      name: 'Avancer 2s',
      category: 'moves',
      effectId: 'input.hold',
      params: { key: 'w', ms: 2000 },
    },
    {
      id: 'in.spin',
      name: 'Demi-tour souris',
      category: 'moves',
      effectId: 'input.sequence',
      params: { script: 'moveby 800 0' },
    },
    {
      id: 'in.drop',
      name: 'Lâcher l’objet (Q)',
      category: 'moves',
      effectId: 'input.tap',
      params: { key: 'q' },
    },
    {
      id: 'in.inventory',
      name: 'Inventaire (E)',
      category: 'moves',
      effectId: 'input.tap',
      params: { key: 'e' },
    },
  ],
  create: (config, deps: IntegrationDeps) => new InputIntegration(config, deps.input),
};
