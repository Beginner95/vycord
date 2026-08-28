import { useState, useRef } from 'react';
import { ProfileSettings } from '@/components/settings/ProfileSettings';
import { AudioSettings } from '@/components/settings/AudioSettings';
import { VideoSettings } from '@/components/settings/VideoSettings';
import { AppearanceSettings } from '@/components/settings/AppearanceSettings';
import { useModalFocus } from '@/hooks/useModalFocus';
import { useT, type TKey } from '@/i18n';
import './Settings.css';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = 'profile' | 'audio' | 'video' | 'appearance';

const TABS: { id: SettingsTab; labelKey: TKey }[] = [
  { id: 'profile', labelKey: 'settings.tabProfile' },
  { id: 'audio', labelKey: 'settings.tabAudio' },
  { id: 'video', labelKey: 'settings.tabVideo' },
  { id: 'appearance', labelKey: 'settings.tabAppearance' },
];

export function Settings({ isOpen, onClose }: SettingsProps) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocus(isOpen, modalRef, onClose);

  if (!isOpen) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div ref={modalRef} className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>{t('settings.title')}</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">
          <nav className="settings-tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {t(tab.labelKey)}
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {activeTab === 'profile' && <ProfileSettings />}
            {activeTab === 'audio' && <AudioSettings />}
            {activeTab === 'video' && <VideoSettings />}
            {activeTab === 'appearance' && <AppearanceSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}
