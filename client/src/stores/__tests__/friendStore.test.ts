import { describe, it, expect, beforeEach } from 'vitest';
import { useFriendStore } from '@/stores/friendStore';
import type { FriendProfile, FriendRequest } from '@/types';

const req = (id: string, userId: string): FriendRequest => ({
  id,
  user: { user_id: userId, username: `u-${userId}` },
  created_at: '2026-09-04T10:00:00Z',
});

const friend = (userId: string): FriendProfile => ({
  user_id: userId,
  username: `u-${userId}`,
  friends_since: '2026-09-04T10:00:00Z',
});

describe('friendStore', () => {
  beforeEach(() => {
    useFriendStore.setState({ friends: [], incoming: [], outgoing: [], blocked: [], loaded: false });
  });

  it('складывает входящую заявку в incoming', () => {
    useFriendStore.getState().applyRequestReceived(req('r1', 'u1'));
    expect(useFriendStore.getState().incoming).toHaveLength(1);
    expect(useFriendStore.getState().incoming[0].user.user_id).toBe('u1');
  });

  it('не дублирует заявку с тем же id при повторном событии', () => {
    // WS может доставить событие дважды после реконнекта — список обязан
    // остаться идемпотентным.
    useFriendStore.getState().applyRequestReceived(req('r1', 'u1'));
    useFriendStore.getState().applyRequestReceived(req('r1', 'u1'));
    expect(useFriendStore.getState().incoming).toHaveLength(1);
  });

  it('убирает заявку из обоих списков при отмене', () => {
    useFriendStore.setState({ incoming: [req('r1', 'u1')], outgoing: [req('r2', 'u2')] });
    useFriendStore.getState().applyRequestCancelled('r2');
    expect(useFriendStore.getState().outgoing).toHaveLength(0);
    expect(useFriendStore.getState().incoming).toHaveLength(1);
  });

  it('удаляет друга по user_id', () => {
    useFriendStore.setState({ friends: [friend('u1'), friend('u2')] });
    useFriendStore.getState().applyFriendRemoved('u1');
    expect(useFriendStore.getState().friends.map((f) => f.user_id)).toEqual(['u2']);
  });

  // Регрессия I3: Block удаляет ЛЮБУЮ строку friendships (в т.ч. pending),
  // но рассылает только friend_removed. Без чистки заявок пользователь видел
  // бы фантомную заявку к/от заблокированного, которая 404-ила бы при
  // попытке ей что-то сделать.
  it('при friend_removed также убирает совпадающую запись из incoming', () => {
    useFriendStore.setState({ incoming: [req('r1', 'u1')], outgoing: [] });
    useFriendStore.getState().applyFriendRemoved('u1');
    expect(useFriendStore.getState().incoming).toHaveLength(0);
  });

  it('при friend_removed также убирает совпадающую запись из outgoing', () => {
    useFriendStore.setState({ incoming: [], outgoing: [req('r2', 'u2')] });
    useFriendStore.getState().applyFriendRemoved('u2');
    expect(useFriendStore.getState().outgoing).toHaveLength(0);
  });
});
