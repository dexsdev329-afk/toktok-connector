import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPins, savePins } from './pin-store';

describe('pin store', () => {
  it('defaults every room to 0000, then applies env and saved PINs', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'pins-')), 'pins.json');
    let pins = loadPins({ roomCount: 3, defaultPin: '0000', envPins: '2:2222', file });
    expect([...pins]).toEqual([
      [1, '0000'],
      [2, '2222'],
      [3, '0000'],
    ]);
    pins.set(3, 'secret-3');
    savePins(file, pins);
    pins = loadPins({ roomCount: 3, defaultPin: '0000', envPins: '2:2222', file });
    expect(pins.get(3)).toBe('secret-3');
  });
});
