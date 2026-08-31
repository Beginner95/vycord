import { describe, it, expect } from 'vitest';
import { snippetAround, splitMatches } from './searchSnippet';

describe('snippetAround', () => {
  it('returns short content untouched', () =>
    expect(snippetAround('короткое', 'кор', 80)).toBe('короткое'));

  it('windows around the first match with ellipses', () => {
    const text = `${'а'.repeat(200)}игла${'б'.repeat(200)}`;
    const out = snippetAround(text, 'игла', 20);
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
    expect(out).toContain('игла');
  });

  it('falls back to the head when the query is absent', () =>
    expect(snippetAround('я'.repeat(300), 'нет', 20)).toBe(`${'я'.repeat(40)}…`));
});

describe('splitMatches', () => {
  it('marks every occurrence, case-insensitively', () =>
    expect(splitMatches('Баг и баг', 'баг')).toEqual([
      { text: 'Баг', match: true },
      { text: ' и ', match: false },
      { text: 'баг', match: true },
    ]));

  it('returns one unmatched part when nothing matches', () =>
    expect(splitMatches('привет', 'zzz')).toEqual([{ text: 'привет', match: false }]));

  it('does not hang on an empty query', () =>
    expect(splitMatches('привет', '')).toEqual([{ text: 'привет', match: false }]));
});
