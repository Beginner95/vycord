import { describe, it, expect } from 'vitest';
import { applyReaction, hasReacted, quickReactions, reactorNames, stickerReactionKey, DEFAULT_QUICK_REACTIONS } from '../reactions';
import type { MemberWithUser, Reaction, Sticker } from '@/types';

const member = (user_id: string, username: string): MemberWithUser =>
  ({ user_id, username, roles: [], joined_at: '' }) as unknown as MemberWithUser;

describe('applyReaction', () => {
  it('adds a new kind at the end', () => {
    const out = applyReaction([{ key: '👍', emoji: '👍', count: 1, user_ids: ['a'] }], '❤️', 'b', true);
    expect(out.map((r) => r.key)).toEqual(['👍', '❤️']);
    expect(out[1]).toEqual({ key: '❤️', emoji: '❤️', count: 1, user_ids: ['b'] });
  });

  it('increments an existing kind once per user', () => {
    const base: Reaction[] = [{ key: '👍', emoji: '👍', count: 1, user_ids: ['a'] }];
    const once = applyReaction(base, '👍', 'b', true);
    expect(once[0]).toMatchObject({ count: 2, user_ids: ['a', 'b'] });
    expect(applyReaction(once, '👍', 'b', true)).toEqual(once);
    expect(base[0].count).toBe(1);
  });

  it('removes the user and drops an emptied kind', () => {
    const base: Reaction[] = [{ key: '👍', emoji: '👍', count: 2, user_ids: ['a', 'b'] }];
    expect(applyReaction(base, '👍', 'b', false)[0]).toMatchObject({ count: 1, user_ids: ['a'] });
    expect(applyReaction(applyReaction(base, '👍', 'b', false), '👍', 'a', false)).toEqual([]);
  });

  it('carries the sticker for a sticker key', () => {
    const s = { id: 's1', name: 'cat', image_url: '/u/cat.png' } as Sticker;
    const out = applyReaction(undefined, stickerReactionKey('s1'), 'a', true, s);
    expect(out[0]).toEqual({ key: 'sticker:s1', sticker: s, count: 1, user_ids: ['a'] });
  });
});

describe('hasReacted', () => {
  it('needs a user id and membership', () => {
    const r: Reaction = { key: '👍', count: 1, user_ids: ['a'] };
    expect(hasReacted(r, 'a')).toBe(true);
    expect(hasReacted(r, 'b')).toBe(false);
    expect(hasReacted(r, undefined)).toBe(false);
    expect(hasReacted({ key: '👍', count: 1 }, 'a')).toBe(false);
  });
});

describe('quickReactions', () => {
  it('recent first, padded with defaults, no duplicates, six total', () => {
    expect(quickReactions(['🔥', '🐶'])).toEqual(['🔥', '🐶', '👍', '❤️', '😂', '😮']);
    expect(quickReactions([])).toEqual(DEFAULT_QUICK_REACTIONS);
    expect(quickReactions(['1', '2', '3', '4', '5', '6', '7'])).toHaveLength(6);
  });
});

describe('reactorNames', () => {
  it('names known members up to the limit and counts the rest', () => {
    const members = [member('a', 'аня'), member('b', 'боря'), member('c', 'вова'), member('d', 'галя')];
    expect(reactorNames({ key: '👍', count: 5, user_ids: ['a', 'b', 'c', 'd', 'x'] }, members))
      .toEqual({ names: ['аня', 'боря', 'вова'], rest: 2 });
  });
  it('skips unknown ids but still counts them', () => {
    expect(reactorNames({ key: '👍', count: 2, user_ids: ['x', 'a'] }, [member('a', 'аня')]))
      .toEqual({ names: ['аня'], rest: 1 });
  });
});
