/**
 * computeBackoffDelay implements "full jitter" (AWS's recommended algorithm):
 * the delay is a uniform random draw between 0 and an exponentially growing
 * ceiling, rather than the ceiling itself.
 *
 * Replaces a fixed 3-second reconnect delay in websocket.ts. That fixed delay
 * meant every client hit a recovering server on the exact same cadence after
 * an outage — full jitter spreads retries out immediately (attempt 0 already
 * varies from 0ms to baseMs) while the growing ceiling still backs off a
 * server that stays down.
 *
 * A pure function so the schedule is testable without mocking timers or
 * Math.random globally — pass `random` to pin a specific draw.
 */
export interface BackoffOptions {
  /** Ceiling for attempt 0. Default 1000ms. */
  baseMs?: number;
  /** Growth rate of the ceiling per attempt. Default 2 (doubles each time). */
  factor?: number;
  /** Upper bound the ceiling never exceeds, however large attempt gets. Default 30000ms. */
  maxMs?: number;
  /** Source of randomness in [0, 1). Defaults to Math.random. */
  random?: () => number;
}

const DEFAULT_BASE_MS = 1000;
const DEFAULT_FACTOR = 2;
const DEFAULT_MAX_MS = 30000;

export function computeBackoffDelay(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? DEFAULT_BASE_MS;
  const factor = options.factor ?? DEFAULT_FACTOR;
  const max = options.maxMs ?? DEFAULT_MAX_MS;
  const random = options.random ?? Math.random;

  const clampedAttempt = Math.max(0, attempt);
  const ceiling = Math.min(max, base * Math.pow(factor, clampedAttempt));
  return Math.floor(random() * ceiling);
}
