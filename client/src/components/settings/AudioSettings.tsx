import { useState, useEffect } from 'react';
import { noiseCancellationService, NoiseCancellationService } from '@/services/noiseCancellation';
import { audioService } from '@/services/audio';
import { useT } from '@/i18n';
import { logger } from '@/utils/logger';

export function AudioSettings() {
  const t = useT();
  const [noiseCancellation, setNoiseCancellation] = useState(false);
  const [ncLoading, setNcLoading] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [msgSound, setMsgSound] = useState(true);
  const [callSound, setCallSound] = useState(true);
  const [voiceSound, setVoiceSound] = useState(true);
  const [volume, setVolume] = useState(0.5);

  useEffect(() => {
    setIsSupported(NoiseCancellationService.isSupported());
    // Подписка не выдаёт текущее состояние при регистрации — без явного чтения
    // default-on не виден до первого notify() (старта звонка).
    const initial = noiseCancellationService.getState();
    setNoiseCancellation(initial.isEnabled);
    setNcLoading(initial.isLoading);
    const unsub = noiseCancellationService.onStateChange((state) => {
      setNoiseCancellation(state.isEnabled);
      setNcLoading(state.isLoading);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const settings = audioService.getSettings();
    setMsgSound(settings.messageSound);
    setCallSound(settings.callSound);
    setVoiceSound(settings.voiceSound);
    setVolume(settings.volume);
  }, []);

  const handleToggleNoiseCancellation = async () => {
    if (ncLoading) return;
    try {
      // Вне звонка меняет только персистентный флаг (микрофон не захватывается);
      // в звонке сервис перекоммутирует активную аудиоцепочку.
      await noiseCancellationService.setEnabled(!noiseCancellation);
    } catch (err) {
      logger.error('Failed to toggle noise cancellation:', err, { module: 'settings' });
    }
  };

  return (
    <div className="settings-section">
      <h3>{t('settings.audio')}</h3>

      <div className="setting-item">
        <div className="setting-info">
          <label>{t('settings.messageNotifications')}</label>
          <p className="setting-description">{t('settings.messageNotificationsDescription')}</p>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={msgSound}
            onChange={(e) => {
              setMsgSound(e.target.checked);
              audioService.updateSettings({ messageSound: e.target.checked });
            }}
          />
          <span className="toggle-slider"></span>
        </label>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <label>{t('settings.callSounds')}</label>
          <p className="setting-description">{t('settings.callSoundsDescription')}</p>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={callSound}
            onChange={(e) => {
              setCallSound(e.target.checked);
              audioService.updateSettings({ callSound: e.target.checked });
            }}
          />
          <span className="toggle-slider"></span>
        </label>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <label>{t('settings.voiceJoinLeaveSounds')}</label>
          <p className="setting-description">{t('settings.voiceJoinLeaveSoundsDescription')}</p>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={voiceSound}
            onChange={(e) => {
              setVoiceSound(e.target.checked);
              audioService.updateSettings({ voiceSound: e.target.checked });
            }}
          />
          <span className="toggle-slider"></span>
        </label>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <label>{t('settings.volume')}</label>
          <p className="setting-description">{t('settings.volumeDescription')}</p>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setVolume(v);
            audioService.setVolume(v);
          }}
          style={{ width: 120, accentColor: 'var(--brand-color)' }}
        />
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <label>{t('settings.testSounds')}</label>
          <p className="setting-description">{t('settings.testSoundsDescription')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => audioService.playMessage()}
            style={{
              padding: '6px 14px',
              border: '1.5px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            💬 {t('settings.testMessage')}
          </button>
          <button
            onClick={() => {
              audioService.startRingtone();
              setTimeout(() => audioService.stopRingtone(), 3000);
            }}
            style={{
              padding: '6px 14px',
              border: '1.5px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            📞 {t('settings.testRing')}
          </button>
          <button
            onClick={() => audioService.playUserJoined()}
            style={{
              padding: '6px 14px',
              border: '1.5px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            ➡️ {t('settings.testJoin')}
          </button>
          <button
            onClick={() => audioService.playUserLeft()}
            style={{
              padding: '6px 14px',
              border: '1.5px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            ⬅️ {t('settings.testLeave')}
          </button>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <label>{t('settings.noiseCancellation')}</label>
          <p className="setting-description">
            {ncLoading
              ? t('settings.noiseCancellationLoading')
              : t('settings.noiseCancellationDescription')}
          </p>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={noiseCancellation}
            onChange={handleToggleNoiseCancellation}
            disabled={!isSupported || ncLoading}
          />
          <span className="toggle-slider"></span>
        </label>
      </div>

      {!isSupported && (
        <p className="setting-warning">
          {t('settings.noiseCancellationUnsupported')}
        </p>
      )}

      <div className="setting-item">
        <div className="setting-info">
          <label>{t('settings.inputDevice')}</label>
          <p className="setting-description">
            {t('settings.inputDeviceDescription')}
          </p>
        </div>
        <select className="setting-select">
          <option>{t('settings.defaultMicrophone')}</option>
        </select>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <label>{t('settings.outputDevice')}</label>
          <p className="setting-description">
            {t('settings.outputDeviceDescription')}
          </p>
        </div>
        <select className="setting-select">
          <option>{t('settings.defaultSpeakers')}</option>
        </select>
      </div>
    </div>
  );
}
