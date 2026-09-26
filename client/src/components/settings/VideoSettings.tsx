import { useEffect } from 'react';
import { useT } from '@/i18n';
import { DeviceSelect } from '@/components/settings/DeviceSelect';
import { useMediaDeviceStore } from '@/stores/mediaDeviceStore';

export function VideoSettings() {
  const t = useT();
  const ensurePermission = useMediaDeviceStore((s) => s.ensurePermission);

  // Метки камер появляются после выдачи разрешения — тихо запрашиваем
  // камеру при открытии раздела «Видео».
  useEffect(() => {
    void ensurePermission('videoinput');
  }, [ensurePermission]);

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t('settings.video')}</h3>

      <div className="setting-row">
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.camera')}</span>
          <p className="setting-row-desc">{t('settings.cameraDescription')}</p>
        </div>
        <DeviceSelect
          kind="videoinput"
          label={t('settings.camera')}
          defaultLabel={t('settings.defaultCamera')}
        />
      </div>
    </div>
  );
}