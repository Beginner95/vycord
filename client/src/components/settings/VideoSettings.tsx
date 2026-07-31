import { useT } from '@/i18n';

export function VideoSettings() {
  const t = useT();
  return (
    <div className="settings-section">
      <h3>{t('settings.video')}</h3>

      <div className="setting-item">
        <div className="setting-info">
          <label>{t('settings.camera')}</label>
          <p className="setting-description">
            {t('settings.cameraDescription')}
          </p>
        </div>
        <select className="setting-select">
          <option>{t('settings.defaultCamera')}</option>
        </select>
      </div>
    </div>
  );
}
