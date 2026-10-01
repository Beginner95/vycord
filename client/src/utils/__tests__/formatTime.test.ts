import { describe, it, expect } from 'vitest';
import { formatTime } from '@/utils/formatTime';
describe('formatTime', () => {
  it('m:ss', () => { expect(formatTime(0)).toBe('0:00'); expect(formatTime(65.9)).toBe('1:05'); expect(formatTime(900)).toBe('15:00'); });
  it('не число → 0:00', () => { expect(formatTime(NaN)).toBe('0:00'); expect(formatTime(Infinity)).toBe('0:00'); });
});
