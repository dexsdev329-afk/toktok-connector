import { describe, expect, it } from 'vitest';
import { ProfanityFilter } from './profanity';

const filter = new ProfanityFilter(['streamsnipe']);

describe('ProfanityFilter', () => {
  it('censors French words with accents, case and leetspeak', () => {
    expect(filter.censor('Quel ENCULÉ ce mec').clean).toBe('Quel bip ce mec');
    expect(filter.censor('espèce de s4lope !').clean).toBe('espèce de bip !');
    expect(filter.censor('fils de pute').clean).toBe('bip');
  });

  it('only matches whole words', () => {
    expect(filter.censor('il est concentré sur sa culture').flagged).toBe(false);
    expect(filter.censor('quel con').clean).toBe('quel bip');
  });

  it('censors English words and custom words', () => {
    expect(filter.censor('what the fuck').flagged).toBe(true);
    expect(filter.censor('no streamsnipe please').clean).toBe('no bip please');
  });

  it('applies modes', () => {
    expect(filter.apply('merde alors', 'off')).toBe('merde alors');
    expect(filter.apply('merde alors', 'censor')).toBe('bip alors');
    expect(filter.apply('merde alors', 'skip')).toBeNull();
    expect(filter.apply('bonjour à tous', 'skip')).toBe('bonjour à tous');
  });
});
