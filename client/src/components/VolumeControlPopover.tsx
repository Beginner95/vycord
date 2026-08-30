import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n';
import './VolumeControlPopover.css';

interface VolumeControlPopoverProps {
  value: number;
  position: { top: number; left: number };
  onChange: (value: number) => void;
  onClose: () => void;
}

export function VolumeControlPopover({ value, position, onChange, onClose }: VolumeControlPopoverProps) {
  const t = useT();
  const popoverRef = useRef<HTMLDivElement>(null);

  // Тот же дефект, что чинился у тултипа качества связи (ruling T4-b): портал в
  // document.body не виден, пока элемент в полноэкранном режиме — top layer
  // рисует только сам fullscreen-элемент и его потомков. Кнопка «на весь экран»
  // в шапке сцены (решение 24) делает фуллскрин всей сцены вместе со всеми
  // плитками, так что этот поповер стал достижим в этом режиме.
  const [host, setHost] = useState<HTMLElement>(
    () => (document.fullscreenElement as HTMLElement | null) ?? document.body,
  );
  const [pos, setPos] = useState(position);

  useEffect(() => setPos(position), [position]);

  useEffect(() => {
    const onFsChange = () =>
      setHost((document.fullscreenElement as HTMLElement | null) ?? document.body);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Позиция приходит от вызывающей кнопки (bottom+6, left) и у правого/нижнего
  // края вьюпорта уезжает за границу. Прижимаем по факту измерения; вычисление
  // идемпотентно, поэтому повторный проход эффекта уже ничего не меняет.
  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    let { top, left } = pos;
    left = Math.max(margin, Math.min(left, window.innerWidth - margin - width));
    top = Math.max(margin, Math.min(top, window.innerHeight - margin - height));
    if (top !== pos.top || left !== pos.left) setPos({ top, left });
  }, [pos]);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={popoverRef}
      className="volume-popover"
      style={{ top: pos.top, left: pos.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="range"
        aria-label={t('call.participantVolume')}
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="volume-popover-slider"
      />
      <span className="volume-popover-value">{value}{t('call.unitPercent')}</span>
    </div>,
    host,
  );
}
