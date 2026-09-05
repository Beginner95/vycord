import { ChevronLeft } from 'lucide-react';
import { useOnlineIds } from '@/hooks/useOnlineIds';
import { FriendsPanel } from '@/components/FriendsPanel';
import { useT } from '@/i18n';
import './HomeView.css';

interface HomeViewProps {
  /** Мобильный "назад" к списку серверов — тот же контракт, что у
   *  ChannelSidebar/UserList (final-review fix I1): без него "Дом" был
   *  мобильным тупиком, из которого некуда вернуться. */
  onMobileBack?: () => void;
}

/**
 * HomeView — главная («Дом»). Владеет панелью главной сама, чтобы AppPage не
 * рос: там остаётся ровно одна развилка рендера.
 *
 * Загрузка friendStore и подписка на его WS-события (initFriendBridge) живут
 * в AppPage на весь срок сессии (final-review fix C4) — раньше они жили
 * здесь и пропадали, как только HomeView размонтировалась (переход на любой
 * сервер), так что входящие заявки и бейдж «Дом» переставали обновляться
 * вживую. HomeView теперь чистый потребитель уже загруженного и уже
 * подписанного состояния — ни load(), ни initFriendBridge() ему знать не надо.
 *
 * Список личек (DMSidebar) приходит в фазе 2 (VYC-91), тоже сюда.
 */
export function HomeView({ onMobileBack }: HomeViewProps) {
  const t = useT();
  // Тот же хук, что у UserList.tsx: HTTP-снимок + подписка на четыре
  // WS-события живут в одном месте (useOnlineIds), а не в двух разошедшихся
  // копиях. Общее СОСТОЯНИЕ им не нужно — UserList и HomeView никогда не
  // смонтированы одновременно (развилка currentServer в AppPage) — но общий
  // КОД обязателен, иначе будущее изменение механизма (новое событие,
  // дебаунс, другая обработка ошибок) молча разойдётся между потребителями.
  const onlineIds = useOnlineIds();

  return (
    <div className="home-view">
      <div className="home-view-mobile-header">
        {onMobileBack && (
          <button className="mobile-back-btn" onClick={onMobileBack} aria-label={t('common.back')}>
            <ChevronLeft size={18} strokeWidth={1.8} />
          </button>
        )}
        <span>{t('server.home')}</span>
      </div>
      <FriendsPanel onlineIds={onlineIds} />
    </div>
  );
}
