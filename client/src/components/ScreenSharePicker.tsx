import { useEffect } from 'react';
import { X } from 'lucide-react';
import { SCREEN_QUALITY_PRESETS } from '@/services/groupCall';
import type { ScreenQuality, ScreenQualityPreset } from '@/services/groupCall';
import type { DesktopCapturerSource } from '@/types/electron';
import { useT } from '@/i18n';
import './ScreenSharePicker.css';

// ─── Screen Source Picker Modal ──────────────────────────────────────────────

interface ScreenSourcePickerProps {
  sources: DesktopCapturerSource[];
  onSelect: (sourceId: string) => void;
  onCancel: () => void;
}

export function ScreenSourcePicker({ sources, onSelect, onCancel }: ScreenSourcePickerProps) {
  const t = useT();
  const screens = sources.filter((s) => s.id.startsWith('screen:'));
  const windows = sources.filter((s) => s.id.startsWith('window:'));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="screen-picker-backdrop" onClick={onCancel}>
      <div className="screen-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="screen-picker-header">
          <span>{t('call.selectScreen')}</span>
          <button className="screen-picker-close" onClick={onCancel}>
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        {screens.length > 0 && (
          <div className="screen-picker-section">
            <div className="screen-picker-section-label">{t('call.entireScreen')}</div>
            <div className="screen-picker-grid">
              {screens.map((s) => (
                <button key={s.id} className="screen-picker-item" onClick={() => onSelect(s.id)}>
                  <img src={s.thumbnail} alt={s.name} className="screen-picker-thumb" />
                  <span className="screen-picker-name">{s.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {windows.length > 0 && (
          <div className="screen-picker-section">
            <div className="screen-picker-section-label">{t('call.applicationWindow')}</div>
            <div className="screen-picker-grid">
              {windows.map((s) => (
                <button key={s.id} className="screen-picker-item" onClick={() => onSelect(s.id)}>
                  {s.appIconUrl
                    ? <img src={s.appIconUrl} alt="" className="screen-picker-app-icon" />
                    : <img src={s.thumbnail} alt={s.name} className="screen-picker-thumb" />
                  }
                  <span className="screen-picker-name">{s.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Screen Quality Picker Modal ─────────────────────────────────────────────

interface ScreenQualityPickerProps {
  onSelect: (quality: ScreenQuality) => void;
  onCancel: () => void;
}

export function ScreenQualityPicker({ onSelect, onCancel }: ScreenQualityPickerProps) {
  const t = useT();
  const entries = Object.entries(SCREEN_QUALITY_PRESETS) as [ScreenQuality, ScreenQualityPreset][];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="screen-picker-backdrop" onClick={onCancel}>
      <div className="screen-quality-modal" onClick={(e) => e.stopPropagation()}>
        <div className="screen-picker-header">
          <span>{t('call.selectQuality')}</span>
          <button className="screen-picker-close" onClick={onCancel}>
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
        <div className="screen-quality-list">
          {entries.map(([key, preset]) => (
            <button key={key} className="screen-quality-item" onClick={() => onSelect(key)}>
              <span className="screen-quality-label">{preset.label}</span>
              <span className="screen-quality-desc">
                {preset.width} × {preset.height} · {preset.frameRate} fps
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
