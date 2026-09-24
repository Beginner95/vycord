import { useCallback, useMemo, useRef, useState } from 'react';
import { pinchZoomReducer, PINCH_ZOOM_IDLE, type PinchZoomState } from './pinchZoom';

interface Point { id: number; x: number; y: number }

export interface PinchZoomHandlers {
  onPointerDown(e: React.PointerEvent): void;
  onPointerMove(e: React.PointerEvent): void;
  onPointerUp(e: React.PointerEvent): void;
  onPointerCancel(e: React.PointerEvent): void;
}

/** Двумя пальцами — зум/пан; двойной тап — сброс. `touch-action: none`
 *  консюмер ставит сам на элемент, пока `state.scale > 1` (спека §6.2). */
export function usePinchZoom(): { state: PinchZoomState; handlers: PinchZoomHandlers; reset: () => void } {
  const [state, setState] = useState<PinchZoomState>(PINCH_ZOOM_IDLE);
  const points = useRef<Map<number, Point>>(new Map());
  const startDist = useRef(0);
  const lastMid = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef(0);

  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  const reset = useCallback(() => setState(PINCH_ZOOM_IDLE), []);

  const handlers = useMemo<PinchZoomHandlers>(() => ({
    onPointerDown(e) {
      points.current.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
      if (points.current.size === 2) {
        const [a, b] = [...points.current.values()];
        startDist.current = dist(a, b);
        lastMid.current = mid(a, b);
      } else if (points.current.size === 1) {
        const now = e.timeStamp;
        if (now - lastTap.current < 300) {
          setState((s) => pinchZoomReducer(s, { type: 'doubleTap' }));
        }
        lastTap.current = now;
      }
    },
    onPointerMove(e) {
      if (!points.current.has(e.pointerId)) return;
      points.current.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
      if (points.current.size === 2) {
        const [a, b] = [...points.current.values()];
        const d = dist(a, b);
        setState((s) => pinchZoomReducer(s, { type: 'pinch', startDist: startDist.current, dist: d, midX: 0, midY: 0 }));
        startDist.current = d;
      } else if (points.current.size === 1 && lastMid.current) {
        const p = points.current.get(e.pointerId)!;
        setState((s) => pinchZoomReducer(s, { type: 'pan', dx: p.x - lastMid.current!.x, dy: p.y - lastMid.current!.y }));
        lastMid.current = { x: p.x, y: p.y };
      }
    },
    onPointerUp(e) {
      points.current.delete(e.pointerId);
      lastMid.current = null;
    },
    onPointerCancel(e) {
      points.current.delete(e.pointerId);
      lastMid.current = null;
    },
  }), []);

  return { state, handlers, reset };
}
