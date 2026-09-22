import { SCREEN_QUALITY_PRESETS } from '@/services/groupCall';
import type { ScreenQuality, ScreenQualityPreset } from '@/services/groupCall';

export interface ScreenQualityBodyProps {
  onSelect: (quality: ScreenQuality) => void;
}

/**
 * Список пресетов качества трансляции без поверхности: `ScreenQualityPicker`
 * (десктоп) оборачивает его в модалку, мобильная шторка
 * (`MobileScreenQualitySheet`) — в `BottomSheet`.
 */
export function ScreenQualityBody({ onSelect }: ScreenQualityBodyProps) {
  const entries = Object.entries(SCREEN_QUALITY_PRESETS) as [ScreenQuality, ScreenQualityPreset][];
  return (
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
  );
}
