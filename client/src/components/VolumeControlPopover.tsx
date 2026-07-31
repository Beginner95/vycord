import { useEffect, useRef } from 'react';
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
      style={{ top: position.top, left: position.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="volume-popover-slider"
      />
      <span className="volume-popover-value">{value}{t('call.unitPercent')}</span>
    </div>,
    document.body,
  );
}
