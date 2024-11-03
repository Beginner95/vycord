import { useState, useEffect } from 'react';
import { noiseCancellationService, NoiseCancellationService } from '@/services/noiseCancellation';
import { audioService } from '@/services/audio';
import './Settings.css';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Settings({ isOpen, onClose }: SettingsProps) {
  const [noiseCancellation, setNoiseCancellation] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [msgSound, setMsgSound] = useState(true);
  const [callSound, setCallSound] = useState(true);
  const [volume, setVolume] = useState(0.5);

  useEffect(() => {
    setIsSupported(NoiseCancellationService.isSupported());
    const unsub = noiseCancellationService.onStateChange((state) => {
      setNoiseCancellation(state.isEnabled);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const settings = audioService.getSettings();
    setMsgSound(settings.messageSound);
    setCallSound(settings.callSound);
    setVolume(settings.volume);
  }, [isOpen]);

  const handleToggleNoiseCancellation = async () => {
    const next = !noiseCancellation;
    try {
      if (next) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        await noiseCancellationService.enableNoiseCancellation(stream);
        // State is updated via onStateChange listener
      } else {
        noiseCancellationService.disableNoiseCancellation('default');
      }
    } catch (err) {
      console.error('Failed to toggle noise cancellation:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>User Settings</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="settings-content">
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
                <label>Noise Cancellation</label>
                <p className="setting-description">Reduce background noise using AI-powered noise suppression</p>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={noiseCancellation}
                  onChange={handleToggleNoiseCancellation}
                  disabled={!isSupported}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>

            {!isSupported && (
              <p className="setting-warning">
                Noise cancellation is not supported in your browser
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

          <div className="settings-section">
            <h3>Video</h3>

            <div className="setting-item">
              <div className="setting-info">
                <label>Camera</label>
                <p className="setting-description">
                  Select your camera
                </p>
              </div>
              <select className="setting-select">
                <option>Default Camera</option>
              </select>
            </div>
          </div>

          <div className="settings-section">
            <h3>Appearance</h3>

            <div className="setting-item">
              <div className="setting-info">
                <label>Theme</label>
              </div>
              <select className="setting-select">
                <option>Dark</option>
                <option>Light</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
