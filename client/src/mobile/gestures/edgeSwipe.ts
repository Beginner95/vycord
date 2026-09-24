const DIST_RATIO = 0.35;     // спека §3.4
const SHEET_RATIO = 0.3;     // спека §4.1
const FLING_V = 0.5;         // px/ms
const FLING_MIN = 24;        // px — ниже это дрожание, а не бросок

export function decideSwipe({ dx, vx, width }: { dx: number; vx: number; width: number }): 'back' | 'cancel' {
  return dx > width * DIST_RATIO || (vx > FLING_V && dx > FLING_MIN) ? 'back' : 'cancel';
}

export function decideSheetDismiss({ dy, vy, height }: { dy: number; vy: number; height: number }): boolean {
  return dy > height * SHEET_RATIO || (vy > FLING_V && dy > FLING_MIN);
}

export interface SwipeTracker {
  start(x: number, y: number, t: number): boolean;
  move(x: number, y: number, t: number): number | null;
  end(width: number): 'back' | 'cancel' | 'none';
}

export function createSwipeTracker({ edge = 20, lock = 10 } = {}): SwipeTracker {
  let x0 = 0, y0 = 0, lastX = 0, lastT = 0, vx = 0;
  let phase: 'idle' | 'pending' | 'active' | 'abandoned' = 'idle';
  return {
    start(x, y, t) {
      if (x > edge) { phase = 'idle'; return false; }
      x0 = x; y0 = y; lastX = x; lastT = t; vx = 0; phase = 'pending';
      return true;
    },
    move(x, y, t) {
      if (phase === 'pending') {
        const ax = Math.abs(x - x0), ay = Math.abs(y - y0);
        if (Math.max(ax, ay) < lock) return null;
        phase = ax > ay && x > x0 ? 'active' : 'abandoned';
      }
      if (phase !== 'active') return null;
      const dt = t - lastT;
      if (dt > 0) vx = (x - lastX) / dt;
      lastX = x; lastT = t;
      return Math.max(0, x - x0);
    },
    end(width) {
      const was = phase;
      phase = 'idle';
      if (was !== 'active') return 'none';
      return decideSwipe({ dx: lastX - x0, vx, width });
    },
  };
}
