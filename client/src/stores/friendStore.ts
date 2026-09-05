import { create } from 'zustand';
import { apiService } from '@/services/api';
import { wsService } from '@/services/websocket';
import { logger } from '@/utils/logger';
import type { FriendProfile, FriendRequest, UserBrief } from '@/types';

interface FriendState {
  friends: FriendProfile[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  blocked: UserBrief[];
  loaded: boolean;

  load: () => Promise<void>;
  applyRequestReceived: (req: FriendRequest) => void;
  applyRequestCancelled: (requestId: string) => void;
  applyFriendAdded: (friend: FriendProfile) => void;
  applyFriendRemoved: (userId: string) => void;
}

export const useFriendStore = create<FriendState>((set) => ({
  friends: [],
  incoming: [],
  outgoing: [],
  blocked: [],
  loaded: false,

  load: async () => {
    try {
      const [friendsRes, requestsRes, blocksRes] = await Promise.all([
        apiService.getFriends(),
        apiService.getFriendRequests(),
        apiService.getBlocks(),
      ]);
      set({
        friends: friendsRes.friends ?? [],
        incoming: requestsRes.incoming ?? [],
        outgoing: requestsRes.outgoing ?? [],
        blocked: blocksRes.blocked ?? [],
        loaded: true,
      });
    } catch (err) {
      logger.error('failed to load friends', err, { module: 'friends' });
    }
  },

  applyRequestReceived: (req) =>
    set((state) =>
      // Идемпотентно: после реконнекта то же событие может прийти повторно.
      state.incoming.some((r) => r.id === req.id)
        ? state
        : { incoming: [req, ...state.incoming] },
    ),

  applyRequestCancelled: (requestId) =>
    set((state) => ({
      incoming: state.incoming.filter((r) => r.id !== requestId),
      outgoing: state.outgoing.filter((r) => r.id !== requestId),
    })),

  applyFriendAdded: (friend) =>
    set((state) => ({
      friends: state.friends.some((f) => f.user_id === friend.user_id)
        ? state.friends
        : [...state.friends, friend],
      // Принятая заявка обязана исчезнуть из «Ожидания» — иначе она
      // останется висеть у обеих сторон до перезагрузки.
      incoming: state.incoming.filter((r) => r.user.user_id !== friend.user_id),
      outgoing: state.outgoing.filter((r) => r.user.user_id !== friend.user_id),
    })),

  applyFriendRemoved: (userId) =>
    set((state) => ({ friends: state.friends.filter((f) => f.user_id !== userId) })),
}));

/**
 * initFriendBridge — подписка стора на WS-события. Тот же приём, что
 * initCallBridge в callStore: обработчики живут в сторе, а не в AppPage,
 * который и без них перегружен. Возвращает функцию отписки.
 */
export function initFriendBridge(): () => void {
  const offs = [
    wsService.on('friend_request', (payload) => {
      useFriendStore.getState().applyRequestReceived(payload as FriendRequest);
    }),
    wsService.on('friend_request_cancelled', (payload) => {
      const { id } = payload as { id: string };
      useFriendStore.getState().applyRequestCancelled(id);
    }),
    wsService.on('friend_added', () => {
      // Событие несёт только user_id второй стороны. Профиль и точное
      // friends_since берём перезагрузкой: она дешевле, чем держать на
      // сервере отдельный «полный» payload ради одного случая.
      void useFriendStore.getState().load();
    }),
    wsService.on('friend_removed', (payload) => {
      const { user_id } = payload as { user_id: string };
      useFriendStore.getState().applyFriendRemoved(user_id);
    }),
  ];

  return () => offs.forEach((off) => off());
}
