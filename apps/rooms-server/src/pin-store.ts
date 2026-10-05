import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PIN_PATTERN, parsePins } from './hub.js';

/**
 * Room PINs: every room starts with DEFAULT_PIN (0000), ROOM_PINS can override some
 * rooms, and PINs changed from the app are saved in DATA_DIR/pins.json (Railway volume).
 */
export function loadPins(opts: {
  roomCount: number;
  defaultPin: string;
  envPins: string | undefined;
  file: string | null;
}): Map<number, string> {
  const pins = new Map<number, string>();
  if (PIN_PATTERN.test(opts.defaultPin))
    for (let r = 1; r <= opts.roomCount; r++) pins.set(r, opts.defaultPin);
  for (const [r, p] of parsePins(opts.envPins, opts.roomCount)) pins.set(r, p);
  if (opts.file) {
    try {
      const saved = JSON.parse(readFileSync(opts.file, 'utf8')) as Record<string, unknown>;
      for (const [k, v] of Object.entries(saved)) {
        const r = Number(k);
        if (
          Number.isInteger(r) &&
          r >= 1 &&
          r <= opts.roomCount &&
          typeof v === 'string' &&
          PIN_PATTERN.test(v)
        )
          pins.set(r, v);
      }
    } catch {
      // no saved PINs yet
    }
  }
  return pins;
}

export function savePins(file: string, pins: Map<number, string>): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(Object.fromEntries(pins), null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}
