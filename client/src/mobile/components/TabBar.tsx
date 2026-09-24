import { CircleUser, LayoutGrid, Users } from 'lucide-react';
import type { TabId } from '@/mobile/nav/types';
import { useT } from '@/i18n';
import './TabBar.css';

const TABS = [
  { id: 'servers', Icon: LayoutGrid, label: 'mobile.tabServers' },
  { id: 'friends', Icon: Users, label: 'mobile.tabFriends' },
  { id: 'profile', Icon: CircleUser, label: 'mobile.tabProfile' },
] as const;

interface TabBarProps {
  active: TabId;
  onSelect: (t: TabId) => void;
  friendsBadge: number;
}

export function TabBar({ active, onSelect, friendsBadge }: TabBarProps) {
  const t = useT();
  return (
    <nav className="tab-bar" aria-label={t('mobile.tabBar')}>
      {TABS.map(({ id, Icon, label }) => (
        <button
          key={id}
          type="button"
          className={`tab-bar-item${active === id ? ' is-active' : ''}`}
          aria-current={active === id ? 'page' : undefined}
          onClick={() => onSelect(id)}
        >
          <span className="tab-bar-icon">
            <Icon size={22} strokeWidth={1.8} />
            {id === 'friends' && friendsBadge > 0 && (
              <span className="tab-bar-badge" aria-label={t('friends.pendingBadge')}>
                {friendsBadge > 99 ? '99+' : friendsBadge}
              </span>
            )}
          </span>
          <span className="tab-bar-label">{t(label)}</span>
        </button>
      ))}
    </nav>
  );
}
