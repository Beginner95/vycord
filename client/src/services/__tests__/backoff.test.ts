import { describe, it, expect } from 'vitest';
import { computeBackoffDelay } from '@/services/backoff';

// Replaces websocket.ts's old fixed 3-second reconnect delay: after a server
// drop, every client used to hammer it again on the exact same 3s cadence.
// Full jitter (AWS's recommended algorithm) spreads that out and still grows
// the ceiling so a client doesn't hammer a server that's still down.

describe('computeBackoffDelay', () => {
  it('is 0 for attempt 0 when random() returns 0 (full jitter floor)', () => {
    expect(computeBackoffDelay(0, { random: () => 0 })).toBe(0);
  });

  it('never exceeds the base delay on the first attempt', () => {
    const delay = computeBackoffDelay(0, { random: () => 0.999999, baseMs: 1000 });
    expect(delay).toBeLessThanOrEqual(1000);
    expect(delay).toBeGreaterThan(0);
  });

  it('grows the ceiling exponentially with the attempt number', () => {
    const random = () => 0.999999; // pins the result to (just under) the ceiling
    const d0 = computeBackoffDelay(0, { random, baseMs: 1000, factor: 2 });
    const d1 = computeBackoffDelay(1, { random, baseMs: 1000, factor: 2 });
    const d2 = computeBackoffDelay(2, { random, baseMs: 1000, factor: 2 });
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
    expect(d2).toBeCloseTo(4000, -2); // base * factor^2, within rounding
  });

  it('caps the ceiling at maxMs no matter how large the attempt number gets', () => {
    const delay = computeBackoffDelay(20, { random: () => 0.999999, baseMs: 1000, factor: 2, maxMs: 30000 });
    expect(delay).toBeLessThanOrEqual(30000);
    expect(delay).toBeGreaterThan(29000); // just under the cap, since random() is ~1
  });

  it('treats a negative attempt the same as attempt 0 rather than shrinking below base', () => {
    const delay = computeBackoffDelay(-5, { random: () => 0.999999, baseMs: 1000 });
    expect(delay).toBeLessThanOrEqual(1000);
  });

  it('defaults to Math.random when no random function is supplied', () => {
    const delay = computeBackoffDelay(0);
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThan(1000);
  });
});
