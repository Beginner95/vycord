/** Решение жеста в лайтбоксе: листать, закрыть или ничего (тап). */
export type LightboxSwipe = 'prev' | 'next' | 'close' | null;

export const TAP_SLOP = 12;   // px — меньше это тап
const PAGE_FRACTION = 0.2;    // доля ширины
const CLOSE_FRACTION = 0.25;  // доля высоты
const FLICK_X = 0.5;          // px/мс
const FLICK_Y = 0.6;          // px/мс
const FLICK_MIN = 24;         // px — быстрый щелчок короче не считается

export function decideLightboxSwipe(i: { dx: number; dy: number; vx: number; vy: number; width: number; height: number }): LightboxSwipe {
  const ax = Math.abs(i.dx);
  const ay = Math.abs(i.dy);
  if (Math.max(ax, ay) < TAP_SLOP) return null;
  if (ay > ax) {
    if (i.dy <= 0) return null;
    return i.dy > i.height * CLOSE_FRACTION || (i.dy >= FLICK_MIN && i.vy > FLICK_Y) ? 'close' : null;
  }
  const passed = ax > i.width * PAGE_FRACTION || (ax >= FLICK_MIN && Math.abs(i.vx) > FLICK_X);
  if (!passed) return null;
  return i.dx < 0 ? 'next' : 'prev';
}
