import { useEffect, useState } from 'react';
import { Globe, Palette, Shield, User as UserIcon, Video, Volume2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { ConfirmModal } from '@/components/ConfirmModal';
import { noiseCancellationService } from '@/services/noiseCancellation';
import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { MobileListRow } from '@/mobile/components/MobileListRow';
import type { SettingsSection } from '@/mobile/nav/types';
import { useT, type TKey } from '@/i18n';
import type { ScreenCtx } from './types';
import './ProfileScreen.css';

const ROWS: { section: SettingsSection; labelKey: TKey; Icon: typeof UserIcon }[] = [
  { section: 'profile', labelKey: 'settings.tabProfile', Icon: UserIcon },
  { section: 'privacy', labelKey: 'settings.privacy', Icon: Shield },
  { section: 'audio', labelKey: 'settings.tabAudio', Icon: Volume2 },
  { section: 'video', labelKey: 'settings.tabVideo', Icon: Video },
  { section: 'appearance', labelKey: 'settings.tabAppearance', Icon: Palette },
  { section: 'language', labelKey: 'settings.language', Icon: Globe },
];

/** Корень вкладки «Профиль» (спека §5.8). Карточка — новая мобильная
 *  разметка (аватар 72 + email — которых `UserPanel` не показывает; тот
 *  компонент остаётся отдельным десктопным боковым виджетом,
 *  `DesktopShell.tsx` не трогаем). Список ведёт в settings{section} (T5). */
export function ProfileScreen({ ctx }: { ctx: ScreenCtx }) {
  const { c, nav } = ctx;
  const t = useT();
  const [ncEnabled, setNcEnabled] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    setNcEnabled(noiseCancellationService.getState().isEnabled);
    const unsub = noiseCancellationService.onStateChange((state) => setNcEnabled(state.isEnabled));
    return unsub;
  }, []);

  return (
    <div className="profile-screen">
      <ScreenHeader title={t('mobile.tabProfile')} />
      <div className="profile-screen-scroll">
        <div className="profile-card">
          <Avatar url={c.user?.avatar_url} username={c.user?.username ?? ''} className="profile-card-avatar" />
          <span className="profile-card-name">{c.user?.username}</span>
          <span className="profile-card-email">{c.user?.email}</span>
          <span className="profile-card-status">
            {t('server.online')}
            {ncEnabled && ` · ${t('channel.ncOn')}`}
          </span>
        </div>
        <div className="profile-list">
          {ROWS.map(({ section, labelKey, Icon }) => (
            <MobileListRow
              key={section}
              avatar={<span className="profile-list-icon"><Icon size={20} strokeWidth={1.8} /></span>}
              title={t(labelKey)}
              onClick={() => nav.push({ kind: 'settings', section })}
            />
          ))}
        </div>
        <button type="button" className="btn btn-danger-soft profile-logout-btn" onClick={() => setConfirmLogout(true)}>
          {t('common.logout')}
        </button>
      </div>

      <ConfirmModal
        open={confirmLogout}
        title={t('common.logoutTitle')}
        body={t('common.logoutBody')}
        confirmLabel={t('common.logout')}
        onConfirm={c.logout}
        onCancel={() => setConfirmLogout(false)}
      />
    </div>
  );
}
