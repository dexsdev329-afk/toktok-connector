import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_DEFINITIONS } from '@toktok/integrations';
import { describe, expect, it } from 'vitest';
import { catalogSlug } from '../lib/catalog';
import en from './en';
import fr from './fr';

const here = path.dirname(fileURLToPath(import.meta.url));
const rendererSrc = path.resolve(here, '..');
const mainSrc = path.resolve(here, '../../../main');

/** Flattens a dictionary into "a.b.c" keys (i18next plural suffixes are folded). */
function keys(obj: object, prefix = ''): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') for (const sub of keys(v as object, key)) out.add(sub);
    else out.add(key.replace(/_(one|other|zero|few|many)$/, ''));
  }
  return out;
}

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return files(p, ext);
    return ext.test(f) && !f.endsWith('.test.ts') ? [p] : [];
  });
}

const frKeys = keys(fr);
const enKeys = keys(en);
/** French names of Minecraft ids: English deliberately shows the game ids (see index.ts). */
const FRENCH_ONLY = /^mcValues\./;
/** Translations of the (French) integration definitions: only for other languages. */
const TRANSLATION_ONLY = /^catalog\./;

describe('i18n', () => {
  it('French and English define exactly the same keys', () => {
    expect([...frKeys].filter((k) => !enKeys.has(k) && !FRENCH_ONLY.test(k))).toEqual([]);
    expect([...enKeys].filter((k) => !frKeys.has(k) && !TRANSLATION_ONLY.test(k))).toEqual([]);
  });

  it('every literal t("…") key used by the interface exists', () => {
    const missing: string[] = [];
    for (const file of files(rendererSrc, /\.tsx?$/)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bt\(\s*'([\w.-]+)'/g)) {
        if (!frKeys.has(m[1]!)) missing.push(`${path.relative(rendererSrc, file)}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every integration / effect label written as an i18n key exists', () => {
    const labels = new Set<string>();
    const add = (l?: string) => {
      if (l && /^[\w-]+(\.[\w-]+)+$/.test(l)) labels.add(l);
    };
    for (const d of BUILTIN_DEFINITIONS) {
      for (const f of d.configFields) {
        add(f.label);
        add(f.help);
      }
      for (const e of d.effects) for (const p of e.params) add(p.label);
    }
    // Host-provided integrations (home games, interactive overlays) declare labels in the main process.
    for (const file of files(mainSrc, /\.ts$/)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/label: '([\w-]+(?:\.[\w-]+)+)'/g)) add(m[1]);
    }
    expect([...labels].filter((l) => !frKeys.has(l))).toEqual([]);
  });
});

describe('English catalog', () => {
  it('translates every integration, effect, preset and category', () => {
    const host = {
      kinds: ['home-games', 'overlays'],
      effects: ['homegame.effect', 'overlay.wheel.spin', 'overlay.timer'],
    };
    const missing: string[] = [];
    const has = (key: string) => enKeys.has(key) || missing.push(key);
    for (const d of BUILTIN_DEFINITIONS) {
      has(`catalog.kinds.${catalogSlug(d.kind)}.name`);
      has(`catalog.kinds.${catalogSlug(d.kind)}.description`);
      for (const e of d.effects) {
        has(`catalog.effects.${catalogSlug(e.id)}.name`);
        if (e.description) has(`catalog.effects.${catalogSlug(e.id)}.description`);
      }
      for (const p of d.presets ?? []) {
        has(`catalog.presets.${catalogSlug(p.id)}`);
        has(`catalog.categories.${catalogSlug(p.category)}`);
      }
    }
    for (const k of host.kinds) has(`catalog.kinds.${k}.name`);
    for (const e of host.effects) has(`catalog.effects.${catalogSlug(e)}.name`);
    expect(missing).toEqual([]);
  });
});
