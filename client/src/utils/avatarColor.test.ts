import { describe, expect, it } from 'vitest';
import { AVATAR_COLORS, avatarColor } from './avatarColor';

describe('avatarColor', () => {
  it('always returns a palette color', () => {
    for (const name of ['joe', 'shaldashk', 'Вася', 'a', '', '🦊']) {
      expect(AVATAR_COLORS).toContain(avatarColor(name));
    }
  });

  it('is deterministic for the same name', () => {
    expect(avatarColor('shaldashk')).toBe(avatarColor('shaldashk'));
    expect(avatarColor('Вася')).toBe(avatarColor('Вася'));
  });

  it('distributes across the palette', () => {
    const names = Array.from({ length: 64 }, (_, i) => `user-${i}`);
    const used = new Set(names.map(avatarColor));
    expect(used.size).toBeGreaterThan(4);
  });
});
