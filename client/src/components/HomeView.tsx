import { useT } from '@/i18n';
import './HomeView.css';

/**
 * HomeView — главная («Дом»). Владеет обеими панелями главной сама, чтобы
 * AppPage не рос: там остаётся ровно одна развилка рендера.
 *
 * Пока это заглушка: раздел «Друзья» (`FriendsPanel`) появляется в задаче 14
 * и встраивается сюда же, не затрагивая AppPage. Список личек (DMSidebar)
 * приходит в фазе 2 (VYC-91), тоже сюда.
 */
export function HomeView() {
  const t = useT();

  return (
    <div className="home-view">
      <h1 className="home-view-placeholder">{t('friends.title')}</h1>
    </div>
  );
}
