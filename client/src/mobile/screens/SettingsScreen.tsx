import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { ProfileAccountBody } from '@/components/settings/ProfileAccountBody';
import { PrivacyBody } from '@/components/settings/PrivacyBody';
import { LanguageBody } from '@/components/settings/LanguageBody';
import { AudioSettings } from '@/components/settings/AudioSettings';
import { VideoSettings } from '@/components/settings/VideoSettings';
import { AppearanceSettings } from '@/components/settings/AppearanceSettings';
import type { SettingsSection } from '@/mobile/nav/types';
import { useT, type TKey } from '@/i18n';
import './SettingsScreen.css';

const TITLE_KEY: Record<SettingsSection, TKey> = {
  profile: 'settings.tabProfile',
  privacy: 'settings.privacy',
  audio: 'settings.tabAudio',
  video: 'settings.tabVideo',
  appearance: 'settings.tabAppearance',
  language: 'settings.language',
};

/** Экран `settings{section}` (спека §5.8, §5.9): каждый пункт списка
 *  «Профиль» (ProfileScreen.tsx, T4) ведёт сюда со своим `section`. Тела —
 *  те же компоненты, что десктопный Settings.tsx: ProfileAccountBody/
 *  PrivacyBody/LanguageBody из T2 для profile/privacy/language;
 *  AudioSettings/VideoSettings/AppearanceSettings переиспользованы БЕЗ
 *  изменений — их CSS (.settings-section, .setting-row, …) уже в бандле
 *  через ProfileSettings.tsx → Settings.tsx (тот же приём, что
 *  MobileGuestSheet.tsx документирует для GuestInvitePopover.css). */
export function SettingsScreen({ section, onBack }: { section: SettingsSection; onBack: () => void }) {
  const t = useT();
  return (
    <div className="settings-screen">
      <ScreenHeader title={t(TITLE_KEY[section])} onBack={onBack} />
      <div className="settings-screen-body">
        {section === 'profile' && <ProfileAccountBody />}
        {section === 'privacy' && <PrivacyBody />}
        {section === 'audio' && <AudioSettings />}
        {section === 'video' && <VideoSettings />}
        {section === 'appearance' && <AppearanceSettings />}
        {section === 'language' && <LanguageBody />}
      </div>
    </div>
  );
}
