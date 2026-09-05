import { describe, it, expect } from 'vitest';
import { EMOJI_CATEGORIES } from '@/utils/emojis';

describe('EMOJI_CATEGORIES', () => {
  it('has unique category ids', () => {
    const ids = EMOJI_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every category has non-empty emojis list', () => {
    for (const c of EMOJI_CATEGORIES) {
      expect(c.emojis.length).toBeGreaterThan(0);
    }
  });

  it('every emoji is a non-empty string', () => {
    for (const c of EMOJI_CATEGORIES) {
      for (const e of c.emojis) {
        expect(e.length).toBeGreaterThan(0);
      }
    }
  });

  it('every category carries a distinct labelKey under chat.emojiCategory', () => {
    const keys = EMOJI_CATEGORIES.map((c) => c.labelKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k.startsWith('chat.emojiCategory.')).toBe(true);
  });
});