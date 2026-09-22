import { useEffect, type RefObject } from 'react';

export const KEYBOARD_INSET_VAR = '--keyboard-inset';
/** Меньше — это сворачивающаяся адресная строка, а не клавиатура. */
const KEYBOARD_MIN_PX = 80;

export function keyboardInset(vv: { height: number; offsetTop: number }, innerHeight: number): number {
  const raw = Math.round(innerHeight - vv.height - vv.offsetTop);
  return raw >= KEYBOARD_MIN_PX ? raw : 0;
}

/** Спека §5.4: на iOS `interactive-widget=resizes-content` игнорируется, поэтому
 *  высоту, отнятую клавиатурой у visualViewport, пишем в `--keyboard-inset` на
 *  оболочку (JS-инжектируемое свойство: потребители несут фоллбек `0px`). */
export function useVisualViewportInset(target: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = target.current;
    const vv = window.visualViewport;
    if (!el || !vv) return;
    const apply = () => el.style.setProperty(KEYBOARD_INSET_VAR, `${keyboardInset(vv, window.innerHeight)}px`);
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      el.style.removeProperty(KEYBOARD_INSET_VAR);
    };
  }, [target]);
}
