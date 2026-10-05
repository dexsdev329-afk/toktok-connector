import type { OverlayFeeder, TimerOp } from '@toktok/core';
import {
  IntegrationError,
  numberParam,
  stringParam,
  type EffectDefinition,
  type Integration,
  type IntegrationDefinition,
} from '@toktok/integrations';
import { z } from 'zod';

const TIMER_OPS: { value: TimerOp; label: string }[] = [
  { value: 'add', label: 'Ajouter du temps' },
  { value: 'set', label: 'Régler le temps' },
  { value: 'start', label: 'Démarrer' },
  { value: 'pause', label: 'Mettre en pause' },
  { value: 'toggle', label: 'Démarrer / pause' },
  { value: 'reset', label: 'Remettre au temps initial' },
];

const EFFECTS: EffectDefinition[] = [
  {
    id: 'overlay.wheel.spin',
    name: 'Faire tourner la roue',
    description:
      'Fait tourner un overlay « Roue ». Les tours s’enchaînent dans l’ordre. Chaque case peut lancer une action.',
    params: [{ key: 'overlay', label: 'overlays.target', type: 'string', default: '*' }],
  },
  {
    id: 'overlay.timer',
    name: 'Minuteur (subathon)',
    description: 'Ajoute du temps au minuteur, le démarre, le met en pause…',
    params: [
      { key: 'overlay', label: 'overlays.target', type: 'string', default: '*' },
      { key: 'op', label: 'overlays.timerOp', type: 'select', default: 'add', options: TIMER_OPS },
      { key: 'seconds', label: 'overlays.seconds', type: 'number', default: 30, min: 0, max: 86_400 },
      {
        key: 'per',
        label: 'overlays.per',
        type: 'select',
        default: 'once',
        options: [
          { value: 'once', label: 'Fixe' },
          { value: 'count', label: '× nombre de cadeaux' },
          { value: 'diamonds', label: '× valeur (💎 / Kicks)' },
        ],
      },
    ],
  },
];

/** Built-in integration driving the interactive overlays (wheel, timer). */
export function overlayEffectsDefinition(
  feeder: () => OverlayFeeder,
): IntegrationDefinition<Record<string, never>> {
  return {
    kind: 'overlays',
    name: 'Overlays interactifs',
    description: 'Fait tourner la roue et pilote le minuteur depuis tes actions.',
    configFields: [],
    configSchema: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
    effects: EFFECTS,
    create: (): Integration => ({
      status: () => ({ state: 'connected' }),
      listEffects: () => EFFECTS,
      connect: async () => {},
      disconnect: async () => {},
      execute: async (effect, ctx) => {
        const target = stringParam(effect, 'overlay', '*').trim() || '*';
        if (effect.effectId === 'overlay.wheel.spin') {
          if (feeder().spinWheel(target, ctx) === 0) throw new IntegrationError(`Aucune roue « ${target} »`);
          return;
        }
        if (effect.effectId === 'overlay.timer') {
          const op = stringParam(effect, 'op', 'add') as TimerOp;
          if (!TIMER_OPS.some((o) => o.value === op)) throw new IntegrationError('Opération inconnue');
          const per = stringParam(effect, 'per', 'once');
          const factor = per === 'count' ? ctx.count : per === 'diamonds' ? ctx.diamonds : 1;
          const seconds = Math.min(30 * 86_400, numberParam(effect, 'seconds', 30, 0, 86_400) * factor);
          if (feeder().controlTimer(target, op, seconds) === 0) {
            throw new IntegrationError(`Aucun minuteur « ${target} »`);
          }
          return;
        }
        throw new IntegrationError(`Effet inconnu : ${effect.effectId}`);
      },
    }),
  };
}
