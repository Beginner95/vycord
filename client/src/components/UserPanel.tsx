import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, LogOut } from 'lucide-react';
import type { User } from '@/types';
import { Avatar } from '@/components/Avatar';
import { ConfirmModal } from '@/components/ConfirmModal';
import { noiseCancellationService } from '@/services/noiseCancellation';
import { useT } from '@/i18n';
import './UserPanel.css';

interface UserPanelProps {
  user: User | null;
  onLogout: () => void;
  onOpenSettings: () => void;
}

/**
 * UserPanel — avatar/username row with Settings and Logout, hoisted out of
 * ChannelSidebar (final-review fix I-C) so both stay reachable regardless of
 * whether a server is selected. Previously this markup only rendered from
 * inside ChannelSidebar's own "server selected" branch, so Settings and
 * Logout became unreachable while "Дом" replaced ChannelSidebar with
 * HomeView.
 */
export function UserPanel({ user, onLogout, onOpenSettings }: UserPanelProps) {
  const t = useT();
  const [ncEnabled, setNcEnabled] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    // Подписка не выдаёт текущее состояние при регистрации — без явного чтения
    // default-on не виден до первого notify() (старта звонка).
    setNcEnabled(noiseCancellationService.getState().isEnabled);
    const unsub = noiseCancellationService.onStateChange((state) => {
      setNcEnabled(state.isEnabled);
    });
    return unsub;
  }, []);

  return (
    <>
      <div className="user-panel">
        <span className="user-avatar-wrap is-online">
          <Avatar url={user?.avatar_url} username={user?.username ?? ''} className="user-avatar-small" />
        </span>
        <div className="user-details">
          <span className="user-tag">{user?.username}</span>
          <span className="user-status-text">
            {t('server.online')}
            {ncEnabled && ` · ${t('channel.ncOn')}`}
          </span>
        </div>
        <div className="user-actions">
          <button
            type="button"
            className="panel-icon-btn"
            onClick={() => onOpenSettings()}
            title={t('settings.title')}
          >
            <SettingsIcon size={16} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="panel-icon-btn is-danger"
            onClick={() => setConfirmLogout(true)}
            title={t('common.logout')}
          >
            <LogOut size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <ConfirmModal
        open={confirmLogout}
        title={t('common.logoutTitle')}
        body={t('common.logoutBody')}
        confirmLabel={t('common.logout')}
        onConfirm={onLogout}
        onCancel={() => setConfirmLogout(false)}
      />
    </>
  );
}
