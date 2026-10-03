import { describe, it, expect } from 'vitest';
import { toMicros, comparePos, isAfter, msgPos } from '../readCursor';

describe('readCursor', () => {
  it('toMicros keeps microseconds that Date.parse would drop', () => {
    expect(toMicros('2026-10-03T10:00:00.000001Z') - toMicros('2026-10-03T10:00:00Z')).toBe(1);
  });
  it('toMicros truncates nanoseconds to microseconds', () => {
    expect(toMicros('2026-10-03T10:00:00.123456789Z')).toBe(toMicros('2026-10-03T10:00:00.123456Z'));
  });
  it('toMicros honours offsets', () => {
    expect(toMicros('2026-10-03T13:00:00.5+03:00')).toBe(toMicros('2026-10-03T10:00:00.500000Z'));
  });
  it('comparePos orders by time, then by id', () => {
    const at = '2026-10-03T10:00:00Z';
    expect(comparePos({ at, id: 'a' }, { at, id: 'b' })).toBeLessThan(0);
    expect(comparePos({ at, id: 'b' }, { at, id: 'b' })).toBe(0);
    expect(comparePos({ at: '2026-10-03T10:00:01Z', id: 'a' }, { at, id: 'z' })).toBeGreaterThan(0);
  });
  it('a cursor without id covers its whole instant', () => {
    const at = '2026-10-03T10:00:00Z';
    expect(comparePos({ at, id: 'ffff' }, { at, id: null })).toBeLessThan(0);
    expect(comparePos({ at, id: null }, { at, id: 'ffff' })).toBeGreaterThan(0);
  });
  it('isAfter: no cursor means nothing is unread', () => {
    const m = msgPos({ id: 'a', created_at: '2026-10-03T10:00:00Z' });
    expect(isAfter(m, undefined)).toBe(false);
    expect(isAfter(m, { at: '2026-10-03T09:00:00Z', id: null })).toBe(true);
    expect(isAfter(m, { at: '2026-10-03T10:00:00Z', id: 'a' })).toBe(false);
  });
});
