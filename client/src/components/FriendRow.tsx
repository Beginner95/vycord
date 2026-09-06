import { useState } from 'react';
import { MoreVertical, UserMinus, Ban, Undo2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { ContextMenu } from '@/components/ContextMenu';
import { useT } from '@/i18n';
import type { UserBrief } from '@/types';

interface FriendRowProps {
  user: UserBrief;
  online: boolean;
  /** Кнопки строки (например, «Принять»/«Отклонить» у заявок). В фазе 1
   *  «Написать» и «Позвонить» НЕ передаются сюда — личные сообщения ещё не
   *  существуют (придут отдельной фазой, VYC-91). Это не забытая доработка. */
  actions?: React.ReactNode;
  onRemove?: () => void;
  onBlock?: () => void;
  onUnblock?: () => void;
}

export function FriendRow({ user, online, actions, onRemove, onBlock, onUnblock }: FriendRowProps) {
  const t = useT();
  // Координаты клика, а не просто boolean: ContextMenu — портал с фиксированным
  // позиционированием, ему нужен якорь. Тот же приём, что у ServerList/ServerMenu.
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const hasMenu = !!(onRemove || onBlock || onUnblock);

  return (
    <div className="friend-row">
      <span className={`user-avatar-wrap${online ? ' is-online' : ''}`}>
        <Avatar url={user.avatar_url ?? undefined} username={user.username} className="friend-row-avatar" />
      </span>
      <div className="friend-row-text">
        <span className="friend-row-name">{user.username}</span>
        <span className={`friend-row-sub${online ? ' is-online' : ''}`}>
          {online ? t('friends.statusOnline') : t('friends.statusOffline')}
        </span>
      </div>
      <div className="friend-row-actions">
        {actions}
        {hasMenu && (
          <button
            type="button"
            className="panel-icon-btn friend-row-menu-btn"
            aria-label={t('friends.rowMenu')}
            onClick={(e) => setMenuAnchor({ x: e.clientX, y: e.clientY })}
          >
            <MoreVertical size={16} strokeWidth={1.8} />
          </button>
        )}
      </div>
      {menuAnchor && (
        <ContextMenu
          x={menuAnchor.x}
          y={menuAnchor.y}
          onClose={() => setMenuAnchor(null)}
          items={[
            ...(onRemove
              ? [{ label: t('friends.remove'), icon: <UserMinus size={16} strokeWidth={1.8} />, danger: true, onClick: onRemove }]
              : []),
            ...(onBlock
              ? [{ label: t('friends.block'), icon: <Ban size={16} strokeWidth={1.8} />, danger: true, onClick: onBlock }]
              : []),
            ...(onUnblock
              ? [{ label: t('friends.unblock'), icon: <Undo2 size={16} strokeWidth={1.8} />, onClick: onUnblock }]
              : []),
          ]}
        />
      )}
    </div>
  );
}
