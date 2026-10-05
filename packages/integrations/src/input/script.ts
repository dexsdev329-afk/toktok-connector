import { MODIFIERS, normalizeKey, type MouseButton } from './driver';

/**
 * Tiny, line-based script language for key/mouse sequences, easy to write by hand:
 *
 *   tap space            press + release a key
 *   tap ctrl+shift+s     key combo (modifiers + key)
 *   hold w 2000          hold a key for 2000 ms
 *   down shift / up shift
 *   wait 500             pause (ms)
 *   type gg wp           type text
 *   click left [double]  mouse click
 *   mousedown left / mouseup left
 *   move 960 540         absolute mouse position
 *   moveby 100 -50       relative mouse move
 *   scroll 0 -3          scroll
 *   # comment
 */
export type InputStep =
  | { op: 'tap'; key: string; modifiers: string[] }
  | { op: 'hold'; key: string; modifiers: string[]; ms: number }
  | { op: 'down' | 'up'; key: string; modifiers: string[] }
  | { op: 'wait'; ms: number }
  | { op: 'type'; text: string }
  | { op: 'click'; button: MouseButton; double: boolean }
  | { op: 'mousedown' | 'mouseup'; button: MouseButton }
  | { op: 'move' | 'moveby' | 'scroll'; x: number; y: number };

export class ScriptError extends Error {
  constructor(
    public readonly line: number,
    message: string,
  ) {
    super(`Ligne ${line} : ${message}`);
    this.name = 'ScriptError';
  }
}

export const MAX_STEPS = 200;
export const MAX_WAIT_MS = 60_000;
export const MAX_TYPE_LENGTH = 200;

function parseCombo(raw: string | undefined, line: number): { key: string; modifiers: string[] } {
  if (!raw) throw new ScriptError(line, 'touche manquante');
  const parts = raw.split('+').filter(Boolean);
  const keys = parts.map((p) => {
    const k = normalizeKey(p);
    if (!k) throw new ScriptError(line, `touche inconnue « ${p} »`);
    return k;
  });
  const key = keys.pop()!;
  for (const m of keys) {
    if (!(MODIFIERS as readonly string[]).includes(m))
      throw new ScriptError(line, `« ${m} » n’est pas un modificateur`);
  }
  return { key, modifiers: keys };
}

function parseInt10(raw: string | undefined, line: number, what: string, min: number, max: number): number {
  const n = Number(raw);
  if (raw === undefined || !Number.isInteger(n)) throw new ScriptError(line, `${what} invalide`);
  if (n < min || n > max) throw new ScriptError(line, `${what} hors limites (${min} à ${max})`);
  return n;
}

function parseButton(raw: string | undefined, line: number): MouseButton {
  const b = (raw ?? 'left').toLowerCase();
  if (b === 'left' || b === 'right' || b === 'middle') return b;
  throw new ScriptError(line, `bouton inconnu « ${raw} »`);
}

export function parseInputScript(source: string): InputStep[] {
  const steps: InputStep[] = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((rawLine, i) => {
    const line = i + 1;
    const text = rawLine.trim();
    if (!text || text.startsWith('#')) return;
    const [cmdRaw, ...args] = text.split(/\s+/);
    const cmd = cmdRaw!.toLowerCase();
    switch (cmd) {
      case 'tap':
      case 'press':
        steps.push({ op: 'tap', ...parseCombo(args[0], line) });
        break;
      case 'hold':
        steps.push({
          op: 'hold',
          ...parseCombo(args[0], line),
          ms: parseInt10(args[1], line, 'durée', 1, MAX_WAIT_MS),
        });
        break;
      case 'down':
      case 'up':
        steps.push({ op: cmd, ...parseCombo(args[0], line) });
        break;
      case 'wait':
      case 'sleep':
        steps.push({ op: 'wait', ms: parseInt10(args[0], line, 'durée', 0, MAX_WAIT_MS) });
        break;
      case 'type': {
        const t = text.slice(cmdRaw!.length).trim();
        if (!t) throw new ScriptError(line, 'texte manquant');
        if (t.length > MAX_TYPE_LENGTH) throw new ScriptError(line, 'texte trop long');
        steps.push({ op: 'type', text: t });
        break;
      }
      case 'click':
        steps.push({
          op: 'click',
          button: parseButton(args[0], line),
          double: args[1]?.toLowerCase() === 'double',
        });
        break;
      case 'mousedown':
      case 'mouseup':
        steps.push({ op: cmd, button: parseButton(args[0], line) });
        break;
      case 'move':
        steps.push({
          op: 'move',
          x: parseInt10(args[0], line, 'x', 0, 16384),
          y: parseInt10(args[1], line, 'y', 0, 16384),
        });
        break;
      case 'moveby':
      case 'scroll':
        steps.push({
          op: cmd,
          x: parseInt10(args[0], line, 'x', -16384, 16384),
          y: parseInt10(args[1], line, 'y', -16384, 16384),
        });
        break;
      default:
        throw new ScriptError(line, `commande inconnue « ${cmdRaw} »`);
    }
    if (steps.length > MAX_STEPS) throw new ScriptError(line, `trop d’étapes (max ${MAX_STEPS})`);
  });
  return steps;
}
