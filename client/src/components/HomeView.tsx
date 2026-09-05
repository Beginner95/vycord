import { useEffect, useState } from 'react';
import { apiService } from '@/services/api';
import { wsService } from '@/services/websocket';
import { useFriendStore, initFriendBridge } from '@/stores/friendStore';
import { FriendsPanel } from '@/components/FriendsPanel';
import { logger } from '@/utils/logger';
import type { User } from '@/types';
import './HomeView.css';

/**
 * HomeView — главная («Дом»). Владеет обеими панелями главной сама, чтобы
 * AppPage не рос: там остаётся ровно одна развилка рендера.
 *
 * Загрузка friendStore и подписка на его WS-события были сознательно
 * отложены до этой задачи (см. task-13-report.md) — именно HomeView первой
 * реально нуждается в данных стора и инициирует их получение.
 *
 * Список личек (DMSidebar) приходит в фазе 2 (VYC-91), тоже сюда.
 */
export function HomeView() {
  const load = useFriendStore((s) => s.load);
  const loaded = useFriendStore((s) => s.loaded);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  useEffect(() => initFriendBridge(), []);

  // Тот же механизм, что у UserList.tsx: HTTP-снимок онлайн-пользователей
  // плюс live-обновление через те же четыре WS-события. Копия состояния
  // умышленно НЕ шарится между компонентами — UserList и HomeView никогда не
  // смонтированы одновременно (развилка currentServer в AppPage), так что
  // общий стор для onlineIds не окупился бы, а только добавил бы лишний слой.
  useEffect(() => {
    loadOnlineIds();

    const unsubscribers = [
      wsService.on('online_users', () => loadOnlineIds()),
      wsService.on('user_joined', () => loadOnlineIds()),
      wsService.on('user_left', () => loadOnlineIds()),
      wsService.on('user_updated', () => loadOnlineIds()),
    ];

    return () => unsubscribers.forEach((unsub) => unsub());
  }, []);

  const loadOnlineIds = async () => {
    try {
      const users = (await apiService.getOnlineUsers()) as User[];
      setOnlineIds(new Set(users.map((u) => u.id)));
    } catch (err) {
      logger.error('Failed to load online users:', err, { module: 'homeView' });
    }
  };

  return (
    <div className="home-view">
      <FriendsPanel onlineIds={onlineIds} />
    </div>
  );
}
