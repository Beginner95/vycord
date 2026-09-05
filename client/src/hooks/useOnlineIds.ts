import { useEffect, useState } from 'react';
import { apiService } from '@/services/api';
import { wsService } from '@/services/websocket';
import { logger } from '@/utils/logger';
import type { User } from '@/types';

/**
 * Множество ID пользователей, онлайн ГЛОБАЛЬНО (не по конкретному серверу):
 * HTTP-снимок через `apiService.getOnlineUsers()` плюс живое обновление по
 * четырём WS-событиям, любое из которых может изменить состав онлайн.
 *
 * Раньше эта логика жила двумя независимыми копиями — в `UserList.tsx` (для
 * списка участников сервера) и в `HomeView.tsx` (для вкладки «В сети» панели
 * друзей). Один хук вместо двух копий: изменение механизма (новое событие,
 * дебаунс, другая обработка ошибок) теперь применяется к обоим потребителям
 * одновременно, а не рискует молча разойтись.
 *
 * Не Zustand-стор: `UserList` и `HomeView`/`FriendsPanel` никогда не
 * смонтированы одновременно (развилка `currentServer` в `AppPage.tsx`), так
 * что общее СОСТОЯНИЕ не окупилось бы — только общий КОД.
 */
export function useOnlineIds(): Set<string> {
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const load = async () => {
      try {
        const users = (await apiService.getOnlineUsers()) as User[];
        setOnlineIds(new Set(users.map((u) => u.id)));
      } catch (err) {
        logger.error('Failed to load online users:', err, { module: 'onlineIds' });
      }
    };

    load();

    const unsubscribers = [
      wsService.on('online_users', () => load()),
      wsService.on('user_joined', () => load()),
      wsService.on('user_left', () => load()),
      wsService.on('user_updated', () => load()),
    ];

    return () => unsubscribers.forEach((unsub) => unsub());
  }, []);

  return onlineIds;
}
