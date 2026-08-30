import { useState, useEffect, useRef } from 'react';
import { ChevronDown, MessageSquare, Phone, LogIn, LogOut } from 'lucide-react';
import { noiseCancellationService, NoiseCancellationService } from '@/services/noiseCancellation';
import { audioService } from '@/services/audio';
import { useMicLevel } from '@/hooks/useMicLevel';
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
  const [testStream, setTestStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState(false);
  // Ref, а не state: читается и пишется синхронно внутри одного обработчика,
  // до того как React успеет применить setState (см. toggleMicTest).
  const micTestPending = useRef(false);
  const level = useMicLevel(testStream, false);

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

  // Захват/освобождение парой: эффект перерегистрируется на каждый новый поток и
  // останавливает предыдущий при смене и при размонтировании. Вариант с пустым
  // массивом зависимостей утёк бы первым потоком при повторной проверке.
  useEffect(() => () => { testStream?.getTracks().forEach((tr) => tr.stop()); }, [testStream]);

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

  // getUserMedia вызывается прямо из компонента: services/ вне зоны этой задачи.
  //
  // Защита от повторного входа. Пока getUserMedia в полёте, testStream ещё null,
  // поэтому второй клик прошёл бы в ту же ветку и открыл ВТОРОЙ захват. Если бы
  // оба результата попали в один коммит React, очистка эффекта сработала бы для
  // замыкания над null и первый поток остался бы висеть — микрофон включён, а
  // кнопка управляет уже вторым потоком, отпустить нечем.
  const toggleMicTest = async () => {
    if (micTestPending.current) return;
    micTestPending.current = true;
    try {
      if (testStream) {
        testStream.getTracks().forEach((tr) => tr.stop());
        setTestStream(null);
        return;
      }
      setMicError(false);
      try {
        setTestStream(await navigator.mediaDevices.getUserMedia({ audio: true }));
      } catch (err) {
        logger.error('Mic test getUserMedia failed:', err, { module: 'settings' });
        setMicError(true);
      }
    } finally {
      micTestPending.current = false;
    }
  };

  return (
    <>
      <div className="settings-section">
        <h3 className="settings-section-title">{t('settings.sectionSounds')}</h3>

        <div className="setting-row">
          <div className="setting-row-info">
            <span className="setting-row-title">{t('settings.messageNotifications')}</span>
            <p className="setting-row-desc">{t('settings.messageNotificationsDescription')}</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              aria-label={t('settings.messageNotifications')}
              checked={msgSound}
              onChange={(e) => {
                setMsgSound(e.target.checked);
                audioService.updateSettings({ messageSound: e.target.checked });
              }}
            />
            <span className="toggle-track" />
          </label>
        </div>

        <div className="setting-row">
          <div className="setting-row-info">
            <span className="setting-row-title">{t('settings.callSounds')}</span>
            <p className="setting-row-desc">{t('settings.callSoundsDescription')}</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              aria-label={t('settings.callSounds')}
              checked={callSound}
              onChange={(e) => {
                setCallSound(e.target.checked);
                audioService.updateSettings({ callSound: e.target.checked });
              }}
            />
            <span className="toggle-track" />
          </label>
        </div>

        <div className="setting-row">
          <div className="setting-row-info">
            <span className="setting-row-title">{t('settings.voiceJoinLeaveSounds')}</span>
            <p className="setting-row-desc">{t('settings.voiceJoinLeaveSoundsDescription')}</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              aria-label={t('settings.voiceJoinLeaveSounds')}
              checked={voiceSound}
              onChange={(e) => {
                setVoiceSound(e.target.checked);
                audioService.updateSettings({ voiceSound: e.target.checked });
              }}
            />
            <span className="toggle-track" />
          </label>
        </div>

        <div className="setting-row">
          <div className="setting-row-info">
            <span className="setting-row-title">{t('settings.volume')}</span>
            <p className="setting-row-desc">{t('settings.volumeDescription')}</p>
          </div>
          <input
            type="range"
            className="slider-input"
            aria-label={t('settings.volume')}
            min="0"
            max="1"
            step="0.05"
            value={volume}
            style={{ '--slider-fill': `${Math.round(volume * 100)}%` } as React.CSSProperties}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setVolume(v);
              audioService.setVolume(v);
            }}
          />
        </div>

        <div className="setting-row">
          <div className="setting-row-info">
            <span className="setting-row-title">{t('settings.testSounds')}</span>
            <p className="setting-row-desc">{t('settings.testSoundsDescription')}</p>
          </div>
          <div className="setting-row-actions">
            <button type="button" className="btn btn-secondary" onClick={() => audioService.playMessage()}>
              <MessageSquare size={16} strokeWidth={1.8} /> {t('settings.testMessage')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                audioService.startRingtone();
                setTimeout(() => audioService.stopRingtone(), 3000);
              }}
            >
              <Phone size={16} strokeWidth={1.8} /> {t('settings.testRing')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => audioService.playUserJoined()}>
              <LogIn size={16} strokeWidth={1.8} /> {t('settings.testJoin')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => audioService.playUserLeft()}>
              <LogOut size={16} strokeWidth={1.8} /> {t('settings.testLeave')}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">{t('settings.sectionMicrophone')}</h3>

        <div className="setting-row">
          <div className="setting-row-info">
            <span className="setting-row-title">{t('settings.noiseCancellation')}</span>
            <p className="setting-row-desc">
              {ncLoading
                ? t('settings.noiseCancellationLoading')
                : t('settings.noiseCancellationDescription')}
            </p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              aria-label={t('settings.noiseCancellation')}
              checked={noiseCancellation}
              onChange={handleToggleNoiseCancellation}
              disabled={!isSupported || ncLoading}
            />
            <span className="toggle-track" />
          </label>
        </div>

        {!isSupported && (
          <p className="setting-warning">{t('settings.noiseCancellationUnsupported')}</p>
        )}

        <div className="setting-row">
          <div className="setting-row-info">
            <span className="setting-row-title">{t('settings.micTest')}</span>
            <p className="setting-row-desc">{t('settings.micTestDescription')}</p>
          </div>
          <div className="mic-test-block">
            {/* role="progressbar" + the full value triple. AttachmentTray.tsx:63
                is the tree's only other progressbar and carries role and
                aria-valuenow ONLY — it is the precedent for the role, not the
                template: a progressbar without min/max reports a bare number
                against an unknown scale. Both are complete as of M6 T5. */}
            <div
              className="level-meter"
              role="progressbar"
              aria-label={t('settings.inputLevel')}
              aria-valuenow={Math.min(100, Math.round(level * 100))}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{ '--meter-level': `${Math.min(100, Math.round(level * 100))}%` } as React.CSSProperties}
            >
              <div className="level-meter-fill" />
            </div>
            <div className="level-meter-caption">{t('settings.inputLevel')}</div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { void toggleMicTest(); }}
            >
              {testStream ? t('settings.micTestStop') : t('settings.micTestStart')}
            </button>
          </div>
        </div>

        {micError && <p className="setting-warning">{t('settings.micTestError')}</p>}
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">{t('settings.sectionDevices')}</h3>

        <div className="setting-row">
          <div className="setting-row-info">
            <span className="setting-row-title">{t('settings.inputDevice')}</span>
            <p className="setting-row-desc">{t('settings.inputDeviceDescription')}</p>
          </div>
          <span className="select-wrap">
            <select className="select-control" aria-label={t('settings.inputDevice')}>
              <option>{t('settings.defaultMicrophone')}</option>
            </select>
            <span className="select-chevron">
              <ChevronDown size={14} strokeWidth={1.8} />
            </span>
          </span>
        </div>

        <div className="setting-row">
          <div className="setting-row-info">
            <span className="setting-row-title">{t('settings.outputDevice')}</span>
            <p className="setting-row-desc">{t('settings.outputDeviceDescription')}</p>
          </div>
          <span className="select-wrap">
            <select className="select-control" aria-label={t('settings.outputDevice')}>
              <option>{t('settings.defaultSpeakers')}</option>
            </select>
            <span className="select-chevron">
              <ChevronDown size={14} strokeWidth={1.8} />
            </span>
          </span>
        </div>
      </div>
    </>
  );
}
