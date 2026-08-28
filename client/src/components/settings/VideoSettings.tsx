import { ChevronDown } from 'lucide-react';
import { useT } from '@/i18n';

export function VideoSettings() {
  const t = useT();
  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t('settings.video')}</h3>

      <div className="setting-row">
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.camera')}</span>
          <p className="setting-row-desc">{t('settings.cameraDescription')}</p>
        </div>
        <span className="select-wrap">
          <select className="select-control">
            <option>{t('settings.defaultCamera')}</option>
          </select>
          <span className="select-chevron">
            <ChevronDown size={14} strokeWidth={1.8} />
          </span>
        </span>
      </div>
    </div>
  );
}
