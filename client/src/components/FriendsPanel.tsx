import { useState } from 'react';
import { apiService, apiErrorText } from '@/services/api';
import { useFriendStore } from '@/stores/friendStore';
import { FriendRow } from '@/components/FriendRow';
import { AddFriendForm } from '@/components/AddFriendForm';
import { useT } from '@/i18n';
import './FriendsPanel.css';

type Tab = 'online' | 'all' | 'pending' | 'blocked';

interface FriendsPanelProps {
  /** ID пользователей онлайн — источник тот же, что у списка участников
   *  сервера (см. UserList.tsx: снимок через apiService.getOnlineUsers() +
   *  подписка на online_users/user_joined/user_left/user_updated). Статусы
   *  НЕ дублируются в friendStore: копия немедленно разошлась бы с
   *  реальностью, а инстансы FriendsPanel и UserList никогда не смонтированы
   *  одновременно (развилка currentServer в AppPage). */
  onlineIds: Set<string>;
}

export function FriendsPanel({ onlineIds }: FriendsPanelProps) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('online');
  const { friends, incoming, outgoing, blocked, load } = useFriendStore();
  const [actionError, setActionError] = useState<string | null>(null);

  // Общий обработчик мутаций строки (принять/отклонить/удалить/(раз)блокировать):
  // выполнить запрос, затем перезагрузить стор целиком. Перезагрузка — не
  // оптимизм: дешевле, чем вручную патчить 4 независимых списка ради
  // единственного действия, и исключает рассинхрон при параллельных мутациях.
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(apiErrorText(err, t));
      setTimeout(() => setActionError(null), 5000);
    }
  };

  const onlineFriends = friends.filter((f) => onlineIds.has(f.user_id));

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'online', label: t('friends.tabOnline') },
    { key: 'all', label: t('friends.tabAll'), count: friends.length },
    { key: 'pending', label: t('friends.tabPending'), count: incoming.length + outgoing.length },
    { key: 'blocked', label: t('friends.tabBlocked') },
  ];

  return (
    <div className="friends-panel">
      <header className="friends-panel-tabs" role="tablist">
        {tabs.map((it) => (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={tab === it.key}
            className={`friends-tab${tab === it.key ? ' is-active' : ''}`}
            onClick={() => setTab(it.key)}
          >
            {it.label}
            {it.count ? <span className="friends-tab-count">{it.count}</span> : null}
          </button>
        ))}
      </header>

      <div className="friends-panel-body">
        {tab === 'online' && (
          onlineFriends.length > 0 ? (
            <ul className="friends-list">
              {onlineFriends.map((f) => (
                <li key={f.user_id}>
                  <FriendRow
                    user={f}
                    online
                    onRemove={() => act(() => apiService.removeFriend(f.user_id))}
                    onBlock={() => act(() => apiService.blockUser(f.user_id))}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="friends-empty">{t('friends.emptyOnline')}</p>
          )
        )}

        {tab === 'all' && (
          friends.length > 0 ? (
            <ul className="friends-list">
              {friends.map((f) => (
                <li key={f.user_id}>
                  <FriendRow
                    user={f}
                    online={onlineIds.has(f.user_id)}
                    onRemove={() => act(() => apiService.removeFriend(f.user_id))}
                    onBlock={() => act(() => apiService.blockUser(f.user_id))}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="friends-empty">{t('friends.emptyAll')}</p>
          )
        )}

        {tab === 'pending' && (
          <>
            <AddFriendForm />
            <h3 className="friends-section-title">{t('friends.incoming')}</h3>
            {incoming.length > 0 ? (
              <ul className="friends-list">
                {incoming.map((r) => (
                  <li key={r.id}>
                    <FriendRow
                      user={r.user}
                      online={onlineIds.has(r.user.user_id)}
                      actions={
                        <>
                          <button
                            type="button"
                            className="btn btn-primary friends-row-btn"
                            onClick={() => act(() => apiService.acceptFriendRequest(r.id))}
                          >
                            {t('friends.accept')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary friends-row-btn"
                            onClick={() => act(() => apiService.deleteFriendRequest(r.id))}
                          >
                            {t('friends.decline')}
                          </button>
                        </>
                      }
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="friends-empty">{t('friends.emptyIncoming')}</p>
            )}

            <h3 className="friends-section-title">{t('friends.outgoing')}</h3>
            {outgoing.length > 0 ? (
              <ul className="friends-list">
                {outgoing.map((r) => (
                  <li key={r.id}>
                    <FriendRow
                      user={r.user}
                      online={onlineIds.has(r.user.user_id)}
                      actions={
                        <button
                          type="button"
                          className="btn btn-secondary friends-row-btn"
                          onClick={() => act(() => apiService.deleteFriendRequest(r.id))}
                        >
                          {t('friends.cancel')}
                        </button>
                      }
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="friends-empty">{t('friends.emptyOutgoing')}</p>
            )}
          </>
        )}

        {tab === 'blocked' && (
          blocked.length > 0 ? (
            <ul className="friends-list">
              {blocked.map((u) => (
                <li key={u.user_id}>
                  <FriendRow
                    user={u}
                    online={false}
                    onUnblock={() => act(() => apiService.unblockUser(u.user_id))}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="friends-empty">{t('friends.emptyBlocked')}</p>
          )
        )}
      </div>

      {actionError && <div className="error-toast">{actionError}</div>}
    </div>
  );
}
