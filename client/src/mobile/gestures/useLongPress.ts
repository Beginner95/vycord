import { useEffect, useMemo, useRef } from 'react';

export interface LongPressHandlers {
  onPointerDown(e: React.PointerEvent): void;
  onPointerMove(e: React.PointerEvent): void;
  onPointerUp(): void;
  onPointerCancel(): void;
  onPointerLeave(): void;
  onContextMenu(e: React.MouseEvent): void;
  onClickCapture(e: React.MouseEvent): void;
}

/** Long-press для тач-ввода (спека §4.4). Мышь игнорируется: на десктопе
 *  правый клик остаётся за ContextMenu. Сработавшее удержание гасит
 *  следующий click, иначе тап-действие строки выполнилось бы вслед за меню. */
export function useLongPress(cb: () => void, { ms = 450, moveTolerance = 8 } = {}): LongPressHandlers {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const touch = useRef(false);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  };
  useEffect(() => clear, []);

  return useMemo<LongPressHandlers>(() => ({
    onPointerDown(e) {
      touch.current = e.pointerType !== 'mouse';
      if (!touch.current || e.button !== 0) return;
      clear();
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        cbRef.current();
      }, ms);
    },
    onPointerMove(e) {
      const o = origin.current;
      if (!o || !timer.current) return;
      if (Math.hypot(e.clientX - o.x, e.clientY - o.y) > moveTolerance) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu(e) {
      if (touch.current) e.preventDefault();
    },
    onClickCapture(e) {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  }), [ms, moveTolerance]);
}
