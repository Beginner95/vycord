import { useEffect, useRef, type RefObject } from 'react';
import { createSwipeTracker } from './edgeSwipe';

/** Свайп «назад» от левого края (спека §3.4). Только touch/pen — мышь не
 *  тянет экраны. Прогресс отдаётся наружу: оболочка сама двигает экран. */
export function useEdgeSwipeBack(
  ref: RefObject<HTMLElement | null>,
  o: { enabled: boolean; onBack: () => void; onProgress: (dx: number | null) => void },
): void {
  const optsRef = useRef(o);
  optsRef.current = o;

  useEffect(() => {
    const el = ref.current;
    if (!el || !o.enabled) return;
    const tracker = createSwipeTracker();
    let pointerId: number | null = null;

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || pointerId !== null) return;
      if (tracker.start(e.clientX, e.clientY, e.timeStamp)) pointerId = e.pointerId;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const dx = tracker.move(e.clientX, e.clientY, e.timeStamp);
      if (dx !== null) optsRef.current.onProgress(dx);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      const verdict = tracker.end(el.clientWidth);
      optsRef.current.onProgress(null);
      if (verdict === 'back') optsRef.current.onBack();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [ref, o.enabled]);
}
