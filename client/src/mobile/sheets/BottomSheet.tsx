import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '@/hooks/useModalFocus';
import { useT } from '@/i18n';
import { useBackDismiss } from './useBackDismiss';
import { decideSheetDismiss } from '@/mobile/gestures/edgeSwipe';
import './BottomSheet.css';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/** Спека §4.1. Scrim — `.modal-overlay` (+ useModalFocus): стек слоёв, Escape
 *  только верхнего, ловушка Tab, isBlockingOverlayOpen(). Вторая система
 *  оверлеев запрещена design-system.md — поэтому здесь нет ни своего z-index,
 *  ни своего Escape. */
export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [dy, setDy] = useState(0);
  const drag = useRef<{ y0: number; y: number; t: number; vy: number } | null>(null);
  useModalFocus(open, ref, onClose);
  useBackDismiss(open, onClose);
  if (!open) return null;

  const onDown = (e: React.PointerEvent) => {
    const body = ref.current?.querySelector('.sheet-body');
    const fromBody = body?.contains(e.target as Node);
    if (fromBody && (body as HTMLElement).scrollTop > 0) return;
    drag.current = { y0: e.clientY, y: e.clientY, t: e.timeStamp, vy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dt = e.timeStamp - d.t;
    if (dt > 0) d.vy = (e.clientY - d.y) / dt;
    d.y = e.clientY;
    d.t = e.timeStamp;
    setDy(Math.max(0, e.clientY - d.y0));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const height = ref.current?.offsetHeight ?? 1;
    const close = decideSheetDismiss({ dy: d.y - d.y0, vy: d.vy, height });
    setDy(0);
    if (close) onClose();
  };

  return createPortal(
    <div className="modal-overlay sheet-overlay" onClick={onClose}>
      <div
        ref={ref}
        className={`sheet sheet-panel${dy > 0 ? ' is-dragging' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={dy > 0 ? { transform: `translateY(${dy}px)` } : undefined}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="sheet-grip" aria-hidden="true" title={t('mobile.sheetHandle')}>
          <span className="sheet-grip-bar" />
        </div>
        {title && <h2 className="sheet-title">{title}</h2>}
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
