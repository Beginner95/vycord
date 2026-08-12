import { describe, it, expect } from 'vitest';
import { collectUnresolvedUserIds } from '@/utils/userCache';

describe('collectUnresolvedUserIds', () => {
  it('returns ids that are not cached, not pending, and not the current user', () => {
    const cached = new Set(['a']);
    const pending = new Set(['b']);
    const result = collectUnresolvedUserIds(
      ['a', 'b', 'c', 'd'],
      'd',
      (id) => cached.has(id),
      (id) => pending.has(id)
    );
    expect(result).toEqual(['c']);
  });

  it('deduplicates repeated ids in the input', () => {
    const result = collectUnresolvedUserIds(['x', 'x', 'y'], undefined, () => false, () => false);
    expect(result).toEqual(['x', 'y']);
  });

  it('returns an empty array when everything is cached', () => {
    const result = collectUnresolvedUserIds(['a', 'b'], undefined, () => true, () => false);
    expect(result).toEqual([]);
  });

  it('returns an empty array when everything is pending', () => {
    const result = collectUnresolvedUserIds(['a', 'b'], undefined, () => false, () => true);
    expect(result).toEqual([]);
  });

  it('excludes the current user even if not cached or pending', () => {
    const result = collectUnresolvedUserIds(['me', 'other'], 'me', () => false, () => false);
    expect(result).toEqual(['other']);
  });

  it('returns an empty array for empty input', () => {
    const result = collectUnresolvedUserIds([], undefined, () => false, () => false);
    expect(result).toEqual([]);
  });
});
