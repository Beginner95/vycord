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
  applyFriendRemoved: (userId: string) => void;
  reset: () => void;
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

  applyFriendRemoved: (userId) =>
    set((state) => ({
      friends: state.friends.filter((f) => f.user_id !== userId),
      // Блокировка удаляет ЛЮБУЮ строку friendships (включая pending), но
      // рассылает только friend_removed — без этой чистки повисшая заявка
      // осталась бы в "Ожидании" и 404-ила бы при попытке ей что-то сделать.
      // Дёшево и безопасно применять и для обычного unfriend: заявки к
      // удалённому другу к этому моменту уже не должно быть.
      incoming: state.incoming.filter((r) => r.user.user_id !== userId),
      outgoing: state.outgoing.filter((r) => r.user.user_id !== userId),
    })),

  // Логаут: без этого следующий вход в том же табе показывает данные
  // предыдущего аккаунта до первого разрешения load() — короткая, но
  // реальная утечка между сессиями (final-review fix M-4).
  reset: () =>
    set({ friends: [], incoming: [], outgoing: [], blocked: [], loaded: false }),
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
      // сервере отдельный «полный» payload ради одного случая. Это
      // единственная и окончательная реализация — не промежуточный
      // воркэраунд: раньше существовал реактивный редьюсер applyFriendAdded
      // на случай, если это событие когда-нибудь станет нести полный
      // профиль, но он был мёртвым кодом (нигде не вызывался из реального
      // WS-пути) с тестами, создававшими ложное впечатление, что путь жив —
      // final-review fix I4 удалил его.
      void useFriendStore.getState().load();
    }),
    wsService.on('friend_removed', (payload) => {
      const { user_id } = payload as { user_id: string };
      useFriendStore.getState().applyFriendRemoved(user_id);
    }),
  ];

  return () => offs.forEach((off) => off());
}
