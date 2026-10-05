import { englishDataset, englishRecommendedTransformers, RegExpMatcher } from 'obscenity';
import { FRENCH_WORDS } from './wordlist-fr';

export type ProfanityMode = 'off' | 'censor' | 'skip';

export interface ProfanityResult {
  clean: string;
  flagged: boolean;
}

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

/** Lowercase, strip accents and simple leetspeak, keeping one output char per input char. */
function normalizeChar(c: string): string {
  const lower = c.toLowerCase();
  const leet = LEET[lower];
  if (leet) return leet;
  const base = lower.normalize('NFD').replace(/\p{M}/gu, '');
  return base.length === 1 ? base : lower.length === 1 ? lower : c;
}

function normalize(text: string): string {
  // Iterate UTF-16 code units so indexes match the original string.
  let out = '';
  for (let i = 0; i < text.length; i++) out += normalizeChar(text[i]!);
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Profanity filter for TTS and overlays: English (obscenity dataset) + French
 * (LDNOOBW list, whole words, accent/leetspeak tolerant) + custom words.
 */
export class ProfanityFilter {
  private readonly english = new RegExpMatcher({
    ...englishDataset.build(),
    ...englishRecommendedTransformers,
  });
  private wordRegex: RegExp | null = null;

  constructor(customWords: string[] = []) {
    this.setCustomWords(customWords);
  }

  setCustomWords(custom: string[]): void {
    const words = [...FRENCH_WORDS, ...custom]
      .map((w) => normalize(w.trim()))
      .filter((w) => w.length >= 2)
      .sort((a, b) => b.length - a.length)
      .map((w) => escapeRegExp(w).replace(/\s+/g, '\\s+'));
    this.wordRegex = words.length
      ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})(?![\\p{L}\\p{N}])`, 'gu')
      : null;
  }

  /** Character ranges [start, end) to hide. */
  private ranges(text: string): [number, number][] {
    const out: [number, number][] = [];
    for (const m of this.english.getAllMatches(text)) out.push([m.startIndex, m.endIndex + 1]);
    if (this.wordRegex) {
      const norm = normalize(text);
      for (const m of norm.matchAll(this.wordRegex)) out.push([m.index, m.index + m[0].length]);
    }
    return out;
  }

  hasProfanity(text: string): boolean {
    return this.ranges(text).length > 0;
  }

  /** Replaces each flagged word by `replacement`. */
  censor(text: string, replacement = 'bip'): ProfanityResult {
    const ranges = this.ranges(text).sort((a, b) => a[0] - b[0]);
    if (!ranges.length) return { clean: text, flagged: false };
    let out = '';
    let pos = 0;
    for (const [start, end] of ranges) {
      if (start < pos) {
        pos = Math.max(pos, end);
        continue;
      }
      out += text.slice(pos, start) + replacement;
      pos = end;
    }
    out += text.slice(pos);
    return { clean: out, flagged: true };
  }

  /** Applies a mode: returns null when the text must not be used at all. */
  apply(text: string, mode: ProfanityMode, replacement = 'bip'): string | null {
    if (mode === 'off') return text;
    const res = this.censor(text, replacement);
    if (mode === 'skip' && res.flagged) return null;
    return res.clean;
  }
}
