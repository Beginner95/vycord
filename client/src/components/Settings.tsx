import { useState, useRef } from 'react';
import { X, User, Volume2, Video, Palette, LogOut, type LucideIcon } from 'lucide-react';
import { ProfileSettings } from '@/components/settings/ProfileSettings';
import { AudioSettings } from '@/components/settings/AudioSettings';
import { VideoSettings } from '@/components/settings/VideoSettings';
import { AppearanceSettings } from '@/components/settings/AppearanceSettings';
import { ConfirmModal } from '@/components/ConfirmModal';
import { useModalFocus } from '@/hooks/useModalFocus';
import { useT, type TKey } from '@/i18n';
import './Settings.css';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  onLogout?: () => void;
}

type SettingsTab = 'profile' | 'audio' | 'video' | 'appearance';

const TABS: { id: SettingsTab; labelKey: TKey; icon: LucideIcon }[] = [
  { id: 'profile', labelKey: 'settings.tabProfile', icon: User },
  { id: 'audio', labelKey: 'settings.tabAudio', icon: Volume2 },
  { id: 'video', labelKey: 'settings.tabVideo', icon: Video },
  { id: 'appearance', labelKey: 'settings.tabAppearance', icon: Palette },
];

export function Settings({ isOpen, onClose, onLogout }: SettingsProps) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [confirmLogout, setConfirmLogout] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocus(isOpen, modalRef, onClose);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2 className="modal-title">{t('settings.title')}</h2>
          <button
            type="button"
            className="modal-close-btn"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        <div className="settings-body">
          <nav className="settings-nav">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`settings-nav-btn${activeTab === tab.id ? ' is-active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <tab.icon size={16} strokeWidth={1.8} />
                {t(tab.labelKey)}
              </button>
            ))}
            {onLogout && (
              <button
                type="button"
                className="settings-nav-btn settings-nav-logout"
                onClick={() => setConfirmLogout(true)}
              >
                <LogOut size={16} strokeWidth={1.8} />
                {t('common.logout')}
              </button>
            )}
          </nav>

          <div className="settings-pane">
            {activeTab === 'profile' && <ProfileSettings />}
            {activeTab === 'audio' && <AudioSettings />}
            {activeTab === 'video' && <VideoSettings />}
            {activeTab === 'appearance' && <AppearanceSettings />}
          </div>
        </div>
      </div>

      {
        // Вложенная модалка — СЕСТРА .settings-modal внутри оверлея Settings, а не
        // его потомок. Только так оверлей подтверждения оказывается в прямом
        // контакте по всплытию с onClick={onClose} этого оверлея, и
        // e.stopPropagation() в ConfirmModal (T3) действительно проверяется.
        // Внутри .settings-modal клик по фону подтверждения гасился бы её
        // собственным stopPropagation, и проверка стала бы фиктивной.
        // z-index: оба оверлея z-1000, но вложенный — потомок контекста
        // наложения внешнего, поэтому рисуется поверх (измерено probe-settings-shell).
        //
        // Строчные //, а не блочный /* */: stripComments в check-i18n.mjs вырезает
        // только // и ОДНОСТРОЧНЫЕ /* */, поэтому многострочный блок — структурная
        // слепая зона (CONSTRAINTS §5). Тот же приём, что в StickerManager.tsx.
      }
      {onLogout && (
        <ConfirmModal
          open={confirmLogout}
          title={t('common.logoutTitle')}
          body={t('common.logoutBody')}
          confirmLabel={t('common.logout')}
          onConfirm={() => {
            setConfirmLogout(false);
            onClose();
            onLogout();
          }}
          onCancel={() => setConfirmLogout(false)}
        />
      )}
    </div>
  );
}
