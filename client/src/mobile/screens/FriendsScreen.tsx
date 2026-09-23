import { useState } from 'react';
import { Plus } from 'lucide-react';
import { apiService, apiErrorText } from '@/services/api';
import { useFriendStore } from '@/stores/friendStore';
import { useOnlineIds } from '@/hooks/useOnlineIds';
import { callService } from '@/services/call';
import { Avatar } from '@/components/Avatar';
import { AddFriendForm } from '@/components/AddFriendForm';
import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { MobileListRow } from '@/mobile/components/MobileListRow';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';
import { BottomSheet } from '@/mobile/sheets/BottomSheet';
import { useFriendMenuItems } from '@/mobile/menus/useFriendMenuItems';
import type { UserBrief, FriendRequest } from '@/types';
import { useT } from '@/i18n';
import './FriendsScreen.css';

type Tab = 'online' | 'all' | 'pending' | 'blocked';

/** Вкладка «Друзья» (спека §5.7). «+» открывает локальную шторку с
 *  AddFriendForm (D1) — не nav.push. Тап по строке друга открывает
 *  ActionSheet напрямую (D5); заявки в «Ожидании» — инлайн-кнопки 44px, не
 *  MobileListRow (там нельзя вкладывать кнопки). */
export function FriendsScreen() {
  const t = useT();
  const [tab, setTab] = useState<Tab>('online');
  const [addOpen, setAddOpen] = useState(false);
  const [menuTarget, setMenuTarget] = useState<UserBrief | null>(null);
  const { friends, incoming, outgoing, blocked, load } = useFriendStore();
  const onlineIds = useOnlineIds();
  const [actionError, setActionError] = useState<string | null>(null);

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
  const menuOnline = !!menuTarget && onlineIds.has(menuTarget.user_id);
  const menuBlocked = !!menuTarget && blocked.some((u) => u.user_id === menuTarget.user_id);
  const menuItems = useFriendMenuItems(menuTarget ?? { user_id: '', username: '' }, menuTarget ? {
    onCall: (menuOnline && !menuBlocked) ? () => { void callService.startCall(menuTarget.user_id); } : undefined,
    onRemove: menuBlocked ? undefined : () => act(() => apiService.removeFriend(menuTarget.user_id)),
    onBlock: menuBlocked ? undefined : () => act(() => apiService.blockUser(menuTarget.user_id)),
    onUnblock: menuBlocked ? () => act(() => apiService.unblockUser(menuTarget.user_id)) : undefined,
  } : {});

  const segments: { key: Tab; label: string; count?: number }[] = [
    { key: 'online', label: t('friends.tabOnline') },
    { key: 'all', label: t('friends.tabAll'), count: friends.length },
    { key: 'pending', label: t('friends.tabPending'), count: incoming.length + outgoing.length },
    { key: 'blocked', label: t('friends.tabBlocked') },
  ];

  const row = (u: UserBrief, online: boolean) => (
    <MobileListRow
      key={u.user_id}
      avatar={<span className={`user-avatar-wrap${online ? ' is-online' : ''}`}><Avatar url={u.avatar_url ?? undefined} username={u.username} className="friends-screen-avatar" /></span>}
      title={u.username}
      subtitle={online ? t('friends.statusOnline') : t('friends.statusOffline')}
      onClick={() => setMenuTarget(u)}
    />
  );

  const pendingRow = (r: FriendRequest, kind: 'incoming' | 'outgoing') => (
    <div className="friends-pending-row" key={r.id}>
      <span className="user-avatar-wrap"><Avatar url={r.user.avatar_url ?? undefined} username={r.user.username} className="friends-screen-avatar" /></span>
      <span className="friends-pending-name">{r.user.username}</span>
      <div className="friends-pending-actions">
        {kind === 'incoming' ? (
          <>
            <button type="button" className="btn btn-primary friends-pending-btn" onClick={() => act(() => apiService.acceptFriendRequest(r.id))}>
              {t('friends.accept')}
            </button>
            <button type="button" className="btn btn-secondary friends-pending-btn" onClick={() => act(() => apiService.deleteFriendRequest(r.id))}>
              {t('friends.decline')}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-secondary friends-pending-btn" onClick={() => act(() => apiService.deleteFriendRequest(r.id))}>
            {t('friends.cancel')}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="friends-screen">
      <ScreenHeader
        title={t('mobile.tabFriends')}
        actions={
          <button type="button" className="screen-header-btn" aria-label={t('mobile.addFriend')} onClick={() => setAddOpen(true)}>
            <Plus size={24} strokeWidth={1.8} />
          </button>
        }
      />
      <div className="friends-segments" role="tablist">
        {segments.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={tab === s.key}
            className={`friends-segment${tab === s.key ? ' is-active' : ''}`}
            onClick={() => setTab(s.key)}
          >
            {s.label}
            {s.count ? <span className="friends-segment-count">{s.count}</span> : null}
          </button>
        ))}
      </div>
      <div className="friends-screen-list">
        {tab === 'online' && (
          onlineFriends.length > 0
            ? onlineFriends.map((f) => row(f, true))
            : <p className="friends-screen-empty">{t('friends.emptyOnline')}</p>
        )}
        {tab === 'all' && (
          friends.length > 0
            ? friends.map((f) => row(f, onlineIds.has(f.user_id)))
            : <p className="friends-screen-empty">{t('friends.emptyAll')}</p>
        )}
        {tab === 'pending' && (
          <>
            <h3 className="friends-screen-section">{t('friends.incoming')}</h3>
            {incoming.length > 0
              ? incoming.map((r) => pendingRow(r, 'incoming'))
              : <p className="friends-screen-empty">{t('friends.emptyIncoming')}</p>}
            <h3 className="friends-screen-section">{t('friends.outgoing')}</h3>
            {outgoing.length > 0
              ? outgoing.map((r) => pendingRow(r, 'outgoing'))
              : <p className="friends-screen-empty">{t('friends.emptyOutgoing')}</p>}
          </>
        )}
        {tab === 'blocked' && (
          blocked.length > 0
            ? blocked.map((u) => row(u, false))
            : <p className="friends-screen-empty">{t('friends.emptyBlocked')}</p>
        )}
      </div>

      <ActionSheet open={menuTarget !== null} onClose={() => setMenuTarget(null)} title={menuTarget?.username} items={menuItems} />
      <BottomSheet open={addOpen} onClose={() => setAddOpen(false)}>
        <AddFriendForm />
      </BottomSheet>
      {actionError && <div className="error-toast">{actionError}</div>}
    </div>
  );
}
