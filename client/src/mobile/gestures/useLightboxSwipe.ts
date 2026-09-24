import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { decideLightboxSwipe, TAP_SLOP } from './lightboxSwipe';

/** Что жест не забирает: свои органы управления и ссылки. */
const IGNORE = 'button, a, input, [data-no-swipe]';

export function useLightboxSwipe(cb: { onPrev(): void; onNext(): void; onClose(): void }) {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  const start = useRef<{ x: number; y: number; id: number; captured: boolean } | null>(null);
  const last = useRef({ x: 0, y: 0, t: 0, vx: 0, vy: 0 });
  const [offset, setOffset] = useState<{ dx: number; dy: number } | null>(null);

  const handlers = {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.pointerType === 'mouse' || (e.target as HTMLElement).closest(IGNORE)) return;
      // Захват НЕ на pointerdown: с захватом click уходит на .lightbox-content, а не на
      // исходную цель, и тап по <video> (play/pause) терялся бы. Захватываем лениво в move.
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, captured: false };
      last.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, vx: 0, vy: 0 };
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const s = start.current;
      if (!s || e.pointerId !== s.id) return;
      const dt = e.timeStamp - last.current.t;
      if (dt > 0) last.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, vx: (e.clientX - last.current.x) / dt, vy: (e.clientY - last.current.y) / dt };
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (!s.captured && Math.max(Math.abs(dx), Math.abs(dy)) >= TAP_SLOP) {
        s.captured = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      if (s.captured) setOffset({ dx, dy });
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const s = start.current;
      start.current = null;
      setOffset(null);
      if (!s) return;
      const decision = decideLightboxSwipe({
        dx: e.clientX - s.x, dy: e.clientY - s.y, vx: last.current.vx, vy: last.current.vy,
        width: window.innerWidth, height: window.innerHeight,
      });
      if (decision === 'next') cbRef.current.onNext();
      else if (decision === 'prev') cbRef.current.onPrev();
      else if (decision === 'close') cbRef.current.onClose();
    },
    onPointerCancel() { start.current = null; setOffset(null); },
  };

  // Экран следует за пальцем по доминирующей оси; в покое style нет (десктопный DOM прежний).
  let style: CSSProperties | undefined;
  if (offset) {
    const horizontal = Math.abs(offset.dx) >= Math.abs(offset.dy);
    style = { transform: horizontal ? `translateX(${offset.dx}px)` : `translateY(${Math.max(0, offset.dy)}px)`, transition: 'none' };
  }
  return { handlers, style };
}
