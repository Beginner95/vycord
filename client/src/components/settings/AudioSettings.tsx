import { useState, useEffect } from 'react';
import { noiseCancellationService, NoiseCancellationService } from '@/services/noiseCancellation';
import { audioService } from '@/services/audio';

export function AudioSettings() {
  const [noiseCancellation, setNoiseCancellation] = useState(false);
  const [ncLoading, setNcLoading] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [msgSound, setMsgSound] = useState(true);
  const [callSound, setCallSound] = useState(true);
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
    setVolume(settings.volume);
  }, []);

  const handleToggleNoiseCancellation = async () => {
    if (ncLoading) return;
    try {
      // Вне звонка меняет только персистентный флаг (микрофон не захватывается);
      // в звонке сервис перекоммутирует активную аудиоцепочку.
      await noiseCancellationService.setEnabled(!noiseCancellation);
    } catch (err) {
      console.error('Failed to toggle noise cancellation:', err);
    }
  };

  return (
    <div className="settings-section">
      <h3>Audio</h3>

      <div className="setting-item">
        <div className="setting-info">
          <label>Message Notifications</label>
          <p className="setting-description">Play a sound when you receive a new message</p>
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
          <label>Call Sounds</label>
          <p className="setting-description">Play ringtone and call status sounds</p>
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
          <label>Volume</label>
          <p className="setting-description">Adjust notification volume</p>
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
          <label>Test Sounds</label>
          <p className="setting-description">Preview notification sounds</p>
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
            💬 Message
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
            📞 Ring
          </button>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <label>Noise Cancellation (DeepFilterNet3)</label>
          <p className="setting-description">
            {ncLoading
              ? 'Loading DeepFilterNet3 model...'
              : 'AI noise suppression — removes background noise from your mic'}
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
          Noise cancellation requires AudioWorklet support (Chrome/Edge/Firefox 76+)
        </p>
      )}

      <div className="setting-item">
        <div className="setting-info">
          <label>Input Device</label>
          <p className="setting-description">
            Select your microphone
          </p>
        </div>
        <select className="setting-select">
          <option>Default Microphone</option>
        </select>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <label>Output Device</label>
          <p className="setting-description">
            Select your speakers
          </p>
        </div>
        <select className="setting-select">
          <option>Default Speakers</option>
        </select>
      </div>
    </div>
  );
}
