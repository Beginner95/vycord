import { useState, useEffect } from 'react';
import { noiseCancellationService, NoiseCancellationService } from '@/services/noiseCancellation';
import { audioService } from '@/services/audio';
import { groupCallService } from '@/services/groupCall';
import { callService } from '@/services/call';
import { useThemeStore } from '@/stores/themeStore';
import './Settings.css';

const DEVICE_PREFS = {
  input:  'vycord_input_device',
  output: 'vycord_output_device',
  camera: 'vycord_camera_device',
} as const;

// Dispatched when the user picks a new output device so call components can
// call setSinkId on their <video> elements without polling localStorage.
export const OUTPUT_DEVICE_EVENT = 'vycord:output_device_changed';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Settings({ isOpen, onClose }: SettingsProps) {
  const { theme, setTheme } = useThemeStore();
  const [noiseCancellation, setNoiseCancellation] = useState(false);
  const [ncLoading, setNcLoading] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [msgSound, setMsgSound] = useState(true);
  const [callSound, setCallSound] = useState(true);
  const [volume, setVolume] = useState(0.5);
  const [testStreamId, setTestStreamId] = useState<string | null>(null);

  const [audioInputs,  setAudioInputs]  = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs,  setVideoInputs]  = useState<MediaDeviceInfo[]>([]);
  const [inputDeviceId,  setInputDeviceId]  = useState('');
  const [outputDeviceId, setOutputDeviceId] = useState('');
  const [cameraDeviceId, setCameraDeviceId] = useState('');
  const [deviceSwitching, setDeviceSwitching] = useState(false);

  const isInCall = groupCallService.isInGroupCallState || callService.isInCallState;

  useEffect(() => {
    setIsSupported(NoiseCancellationService.isSupported());
    const unsub = noiseCancellationService.onStateChange((state) => {
      setNoiseCancellation(state.isEnabled);
      setNcLoading(state.isLoading);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const settings = audioService.getSettings();
    setMsgSound(settings.messageSound);
    setCallSound(settings.callSound);
    setVolume(settings.volume);

    setInputDeviceId(localStorage.getItem(DEVICE_PREFS.input)   ?? '');
    setOutputDeviceId(localStorage.getItem(DEVICE_PREFS.output) ?? '');
    setCameraDeviceId(localStorage.getItem(DEVICE_PREFS.camera) ?? '');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const enumerate = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setAudioInputs(devices.filter((d) => d.kind === 'audioinput'));
        setAudioOutputs(devices.filter((d) => d.kind === 'audiooutput'));
        setVideoInputs(devices.filter((d) => d.kind === 'videoinput'));
      } catch { /* permission not granted yet */ }
    };

    enumerate();
    navigator.mediaDevices.addEventListener('devicechange', enumerate);
    return () => navigator.mediaDevices.removeEventListener('devicechange', enumerate);
  }, [isOpen]);

  const handleToggleNoiseCancellation = async () => {
    if (ncLoading) return;
    const next = !noiseCancellation;
    try {
      if (next) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setTestStreamId(stream.id);
        await noiseCancellationService.enableNoiseCancellation(stream);
      } else {
        noiseCancellationService.disableNoiseCancellation(testStreamId ?? '');
        setTestStreamId(null);
      }
    } catch (err) {
      console.error('Failed to toggle noise cancellation:', err);
    }
  };

  const handleInputDeviceChange = async (deviceId: string) => {
    setInputDeviceId(deviceId);
    localStorage.setItem(DEVICE_PREFS.input, deviceId);

    if (!isInCall) return;
    setDeviceSwitching(true);
    try {
      if (groupCallService.isInGroupCallState) {
        await groupCallService.switchAudioInput(deviceId);
      } else {
        await callService.switchAudioInput(deviceId);
      }
    } finally {
      setDeviceSwitching(false);
    }
  };

  const handleCameraDeviceChange = async (deviceId: string) => {
    setCameraDeviceId(deviceId);
    localStorage.setItem(DEVICE_PREFS.camera, deviceId);

    if (!isInCall) return;
    setDeviceSwitching(true);
    try {
      if (groupCallService.isInGroupCallState) {
        await groupCallService.switchCamera(deviceId);
      } else {
        await callService.switchCamera(deviceId);
      }
    } finally {
      setDeviceSwitching(false);
    }
  };

  const handleOutputDeviceChange = (deviceId: string) => {
    setOutputDeviceId(deviceId);
    localStorage.setItem(DEVICE_PREFS.output, deviceId);
    window.dispatchEvent(new CustomEvent(OUTPUT_DEVICE_EVENT, { detail: deviceId }));
  };

  const deviceLabel = (d: MediaDeviceInfo, idx: number, prefix: string) =>
    d.label || `${prefix} ${idx + 1}`;

  if (!isOpen) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>User Settings</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        {isInCall && (
          <div className="settings-in-call-banner">
            🔴 You are in a call — device changes apply immediately
          </div>
        )}

        {deviceSwitching && (
          <div className="settings-in-call-banner settings-in-call-banner--switching">
            Switching device…
          </div>
        )}

        <div className="settings-content">
          {/* ── Devices ── */}
          <div className="settings-section">
            <h3>Devices</h3>

            <div className="setting-item">
              <div className="setting-info">
                <label>Microphone</label>
                <p className="setting-description">
                  {isInCall ? 'Switch applies immediately — no need to rejoin' : 'Used when joining a call'}
                </p>
              </div>
              <select
                className="setting-select"
                value={inputDeviceId}
                onChange={(e) => { void handleInputDeviceChange(e.target.value); }}
                disabled={deviceSwitching}
              >
                <option value="">Default Microphone</option>
                {audioInputs.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {deviceLabel(d, i, 'Microphone')}
                  </option>
                ))}
              </select>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <label>Speakers / Headphones</label>
                <p className="setting-description">
                  {isInCall
                    ? 'Switch applies to incoming audio immediately'
                    : 'Used for call audio output'}
                </p>
              </div>
              <select
                className="setting-select"
                value={outputDeviceId}
                onChange={(e) => handleOutputDeviceChange(e.target.value)}
              >
                <option value="">Default Speakers</option>
                {audioOutputs.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {deviceLabel(d, i, 'Speaker')}
                  </option>
                ))}
              </select>
            </div>

            <div className="setting-item">
              <div className="setting-info">
                <label>Camera</label>
                <p className="setting-description">
                  {isInCall && groupCallService.isInGroupCallState && (groupCallService as any)._isScreenSharing
                    ? 'Camera will switch after screen sharing ends'
                    : isInCall
                      ? 'Switch applies immediately'
                      : 'Used when joining a call'}
                </p>
              </div>
              <select
                className="setting-select"
                value={cameraDeviceId}
                onChange={(e) => { void handleCameraDeviceChange(e.target.value); }}
                disabled={deviceSwitching}
              >
                <option value="">Default Camera</option>
                {videoInputs.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {deviceLabel(d, i, 'Camera')}
                  </option>
                ))}
              </select>
            </div>

            {audioOutputs.length === 0 && (
              <p className="setting-warning">
                Output device selection requires microphone permission. Join a call or grant mic access to see available speakers.
              </p>
            )}
          </div>

          {/* ── Audio ── */}
          <div className="settings-section">
            <h3>Audio</h3>

            <div className="setting-item">
              <div className="setting-info">
                <label>Noise Cancellation (DeepFilterNet3)</label>
                <p className="setting-description">
                  {ncLoading
                    ? 'Loading DeepFilterNet3 model...'
                    : isInCall
                      ? 'Toggle takes effect on next mic selection or call join'
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
          </div>

          {/* ── Appearance ── */}
          <div className="settings-section">
            <h3>Appearance</h3>

            <div className="setting-item">
              <div className="setting-info">
                <label>Theme</label>
                <p className="setting-description">Choose between light and dark interface</p>
              </div>
              <select
                className="setting-select"
                value={theme}
                onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
