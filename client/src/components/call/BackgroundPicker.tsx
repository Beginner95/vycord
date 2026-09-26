import { useEffect, useMemo, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n';
import { useDismissOnOutside } from '@/hooks/useDismissOnOutside';
import { useBackgroundStore, BACKGROUND_MODES, type BackgroundMode } from '@/stores/backgroundStore';
import './BackgroundPicker.css';

interface BackgroundPickerProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

/**
 * Быстрая панель эффекта фона во время звонка. Монтируется только пока
 * открыта — контракт useDismissOnOutside (client/docs/design-system.md,
 * «Overlays»). Позиционируется от кнопки-якоря ректом.
 */
export function BackgroundPicker({ anchorRef, onClose }: BackgroundPickerProps) {
  const t = useT();
  const containerRef = useDismissOnOutside<HTMLDivElement>(onClose);
  const mode = useBackgroundStore((s) => s.mode);
  const setMode = useBackgroundStore((s) => s.setMode);
  const backgroundId = useBackgroundStore((s) => s.backgroundId);
  const setBackground = useBackgroundStore((s) => s.setBackground);
  const list = useBackgroundStore((s) => s.list);
  const listStatus = useBackgroundStore((s) => s.listStatus);
  const fetchBackgrounds = useBackgroundStore((s) => s.fetchBackgrounds);

  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPosition({ top: rect.bottom + 8, left: rect.left });
    void fetchBackgrounds();
  }, [anchorRef, fetchBackgrounds]);

  const labels: Record<BackgroundMode, string> = useMemo(() => ({
    none: t('call.bgModeNone'),
    blur: t('call.bgModeBlur'),
    image: t('call.bgModeImage'),
  }), [t]);

  return createPortal(
    <div
      className="background-picker"
      ref={containerRef}
      style={{ top: position.top, left: position.left }}
    >
      <div className="background-picker-head">{t('call.bgMenu')}</div>
      <div className="background-picker-modes" role="group" aria-label={t('call.bgMenu')}>
        {BACKGROUND_MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={`background-picker-mode${mode === m ? ' is-active' : ''}`}
            onClick={() => setMode(m)}
          >
            {labels[m]}
          </button>
        ))}
      </div>
      {mode === 'image' && (
        <div className="background-picker-strip">
          {listStatus === 'error' || list === null || list.length === 0 ? (
            <span className="background-picker-note">{t('call.bgUnavailable')}</span>
          ) : (
            list.map((bg) => (
              <button
                key={bg.id}
                type="button"
                className={`background-picker-thumb${backgroundId === bg.id ? ' is-active' : ''}`}
                onClick={() => setBackground(bg.id)}
                title={bg.name}
              >
                <img src={bg.url} alt={bg.name} loading="lazy" />
              </button>
            ))
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}