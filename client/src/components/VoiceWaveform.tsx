import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useT } from '@/i18n';
import { formatTime } from '@/utils/formatTime';
import { barsForWidth, resampleWaveform, WAVEFORM_LEN } from '@/voice/waveform';

interface Props { values: number[]; progress: number; durationSec: number; onSeek(fraction: number): void }

const STEP_SEC = 5;

/**
 * Волна голосового: до 64 столбиков (на узком экране — сколько влезает),
 * клик/перетаскивание и стрелки — перемотка.
 */
export function VoiceWaveform({ values, progress, durationSec, onSeek }: Props) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const bars = resampleWaveform(values.length ? values : new Array(WAVEFORM_LEN).fill(0), barsForWidth(width));
  const played = Math.round(progress * bars.length);

  const fractionAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0;
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(fractionAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => { if (dragging.current) onSeek(fractionAt(e.clientX)); };
  const stop = () => { dragging.current = false; };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (durationSec <= 0) return;
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? STEP_SEC : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -STEP_SEC : 0;
    if (!delta) return;
    e.preventDefault();
    onSeek(Math.min(1, Math.max(0, (progress * durationSec + delta) / durationSec)));
  };

  return (
    <div
      ref={ref}
      className="voice-msg-wave"
      role="slider"
      tabIndex={0}
      aria-label={t('voice.position')}
      aria-valuemin={0}
      aria-valuemax={Math.round(durationSec)}
      aria-valuenow={Math.round(progress * durationSec)}
      aria-valuetext={formatTime(progress * durationSec)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={onKeyDown}
    >
      {bars.map((v, i) => (
        <span
          key={i}
          className={`voice-msg-bar${i < played ? ' is-played' : ''}`}
          style={{ '--voice-bar-h': `${Math.max(12, (v / 255) * 100)}%` } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
