import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { useBackgroundStore, BACKGROUND_MODES, type BackgroundMode } from '@/stores/backgroundStore';
import { useVideoEffects } from '@/hooks/useVideoEffects';
import './BackgroundSettings.css';

/** Живое превью: камера + текущий эффект. Раздельный компонент, чтобы
 *  стрим жил ровно столько, сколько видна секция. val: превью не подменяет
 *  треки — onTrack no-op. */
function BackgroundPreview() {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState(false);
  const mode = useBackgroundStore((s) => s.mode);
  const backgroundId = useBackgroundStore((s) => s.backgroundId);

  useEffect(() => {
    let cancelled = false;
    let owned: MediaStream | null = null;
    void navigator.mediaDevices
      ?.getUserMedia({ video: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        owned = stream;
        setCamera(stream);
      })
      .catch(() => {
        if (!cancelled) setCameraError(true);
      });
    return () => {
      cancelled = true;
      owned?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  const { output } = useVideoEffects(camera, mode, backgroundId, () => {});

  useEffect(() => {
    if (videoRef.current && output) {
      videoRef.current.srcObject = output;
    }
  }, [output]);

  return (
    <div className="background-preview">
      {cameraError && <div className="background-preview-empty">{t('settings.backgroundEffectUnavailable')}</div>}
      {!cameraError && (
        <video ref={videoRef} autoPlay playsInline muted className="background-preview-video" />
      )}
    </div>
  );
}

function ModeSwitch() {
  const t = useT();
  const mode = useBackgroundStore((s) => s.mode);
  const setMode = useBackgroundStore((s) => s.setMode);
  const labels: Record<BackgroundMode, string> = {
    none: t('settings.bgModeNone'),
    blur: t('settings.bgModeBlur'),
    image: t('settings.bgModeImage'),
  };

  return (
    <div className="background-modes" role="group" aria-label={t('settings.backgroundTitle')}>
      {BACKGROUND_MODES.map((m) => (
        <button
          key={m}
          type="button"
          className={`background-mode-btn${mode === m ? ' is-active' : ''}`}
          onClick={() => setMode(m)}
        >
          {labels[m]}
        </button>
      ))}
    </div>
  );
}

function BackgroundGallery() {
  const t = useT();
  const mode = useBackgroundStore((s) => s.mode);
  const backgroundId = useBackgroundStore((s) => s.backgroundId);
  const setBackground = useBackgroundStore((s) => s.setBackground);
  const list = useBackgroundStore((s) => s.list);
  const listStatus = useBackgroundStore((s) => s.listStatus);
  const fetchBackgrounds = useBackgroundStore((s) => s.fetchBackgrounds);

  useEffect(() => {
    void fetchBackgrounds();
  }, [fetchBackgrounds]);

  if (mode !== 'image') return null;
  if (listStatus === 'error') {
    return <p className="background-unavailable">{t('settings.backgroundUnavailable')}</p>;
  }
  if (list === null || list.length === 0) {
    return <p className="background-unavailable">{t('settings.backgroundUnavailable')}</p>;
  }

  return (
    <div className="background-grid">
      {list.map((bg) => (
        <button
          key={bg.id}
          type="button"
          className={`background-cell${backgroundId === bg.id ? ' is-active' : ''}`}
          onClick={() => setBackground(bg.id)}
          title={bg.name}
        >
          <img src={bg.url} alt={bg.name} loading="lazy" />
        </button>
      ))}
    </div>
  );
}

export function BackgroundSettings() {
  const t = useT();

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t('settings.backgroundTitle')}</h3>

      <div className="setting-row">
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.backgroundTitle')}</span>
          <p className="setting-row-desc">{t('settings.backgroundDescription')}</p>
        </div>
        <ModeSwitch />
      </div>

      <BackgroundGallery />
      <BackgroundPreview />
    </div>
  );
}