import { describe, it, expect } from 'vitest';
import { decideSwipe, decideSheetDismiss, createSwipeTracker } from '@/mobile/gestures/edgeSwipe';

describe('decideSwipe', () => {
  it('distance past 35% of width goes back', () => {
    expect(decideSwipe({ dx: 140, vx: 0, width: 390 })).toBe('back');
    expect(decideSwipe({ dx: 130, vx: 0, width: 390 })).toBe('cancel');
  });
  it('a fast fling goes back even when short, but not a tiny twitch', () => {
    expect(decideSwipe({ dx: 40, vx: 0.8, width: 390 })).toBe('back');
    expect(decideSwipe({ dx: 10, vx: 2, width: 390 })).toBe('cancel');
  });
});

describe('decideSheetDismiss', () => {
  it('30% of height or a fling closes', () => {
    expect(decideSheetDismiss({ dy: 121, vy: 0, height: 400 })).toBe(true);
    expect(decideSheetDismiss({ dy: 100, vy: 0, height: 400 })).toBe(false);
    expect(decideSheetDismiss({ dy: 40, vy: 0.9, height: 400 })).toBe(true);
    expect(decideSheetDismiss({ dy: -50, vy: 2, height: 400 })).toBe(false);
  });
});

describe('createSwipeTracker', () => {
  it('ignores starts away from the left edge', () => {
    expect(createSwipeTracker().start(60, 300, 0)).toBe(false);
  });
  it('locks horizontal after 10px and reports dx', () => {
    const t = createSwipeTracker();
    expect(t.start(5, 300, 0)).toBe(true);
    expect(t.move(10, 302, 16)).toBeNull();          // до порога оси
    expect(t.move(30, 304, 32)).toBe(25);
    expect(t.move(200, 306, 200)).toBe(195);
    expect(t.end(390)).toBe('back');
  });
  it('abandons when the gesture is vertical', () => {
    const t = createSwipeTracker();
    t.start(5, 300, 0);
    expect(t.move(8, 330, 16)).toBeNull();
    expect(t.move(100, 400, 32)).toBeNull();
    expect(t.end(390)).toBe('none');
  });
  it('a slow short drag cancels', () => {
    const t = createSwipeTracker();
    t.start(5, 300, 0);
    t.move(60, 300, 500);
    expect(t.end(390)).toBe('cancel');
  });
});
