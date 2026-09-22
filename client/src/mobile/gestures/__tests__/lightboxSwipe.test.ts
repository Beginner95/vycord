import { describe, it, expect } from 'vitest';
import { decideLightboxSwipe as d } from '@/mobile/gestures/lightboxSwipe';

const base = { vx: 0, vy: 0, width: 400, height: 800 };
describe('decideLightboxSwipe', () => {
  it('swipe left past 20% width → next; right → prev', () => {
    expect(d({ ...base, dx: -100, dy: 5 })).toBe('next');
    expect(d({ ...base, dx: 100, dy: 5 })).toBe('prev');
  });
  it('a fast short flick pages too, a slow short drag does not', () => {
    expect(d({ ...base, dx: -30, dy: 0, vx: -0.7 })).toBe('next');
    expect(d({ ...base, dx: -30, dy: 0, vx: -0.1 })).toBeNull();
  });
  it('swipe down past 25% height (or fast) → close; up never closes', () => {
    expect(d({ ...base, dx: 4, dy: 250 })).toBe('close');
    expect(d({ ...base, dx: 4, dy: 50, vy: 0.9 })).toBe('close');
    expect(d({ ...base, dx: 4, dy: -300 })).toBeNull();
  });
  it('the dominant axis wins', () => {
    expect(d({ ...base, dx: -120, dy: 260 })).toBe('close');
    expect(d({ ...base, dx: -200, dy: 120 })).toBe('next');
  });
  it('tiny movement is a tap, not a gesture', () => {
    expect(d({ ...base, dx: 6, dy: 4, vx: 1, vy: 1 })).toBeNull();
  });
});
