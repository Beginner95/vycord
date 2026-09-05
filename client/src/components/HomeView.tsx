import { useEffect } from 'react';
import { useFriendStore, initFriendBridge } from '@/stores/friendStore';
import { useOnlineIds } from '@/hooks/useOnlineIds';
import { FriendsPanel } from '@/components/FriendsPanel';
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
  // Тот же хук, что у UserList.tsx: HTTP-снимок + подписка на четыре
  // WS-события живут в одном месте (useOnlineIds), а не в двух разошедшихся
  // копиях. Общее СОСТОЯНИЕ им не нужно — UserList и HomeView никогда не
  // смонтированы одновременно (развилка currentServer в AppPage) — но общий
  // КОД обязателен, иначе будущее изменение механизма (новое событие,
  // дебаунс, другая обработка ошибок) молча разойдётся между потребителями.
  const onlineIds = useOnlineIds();

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  useEffect(() => initFriendBridge(), []);

  return (
    <div className="home-view">
      <FriendsPanel onlineIds={onlineIds} />
    </div>
  );
}
