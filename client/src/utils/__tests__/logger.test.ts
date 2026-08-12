import { describe, it, expect } from 'vitest';
import { toError } from '@/utils/logger';

describe('toError', () => {
  it('returns Error instances unchanged', () => {
    const original = new Error('boom');
    expect(toError(original)).toBe(original);
  });

  it('extracts the event type for a plain Event instead of "[object Event]"', () => {
    const result = toError(new Event('error'));
    expect(result).toBeInstanceOf(Error);
    expect(result.message).not.toBe('[object Event]');
    expect(result.message).toContain('error');
  });

  it('extracts code/reason/wasClean for a CloseEvent-shaped object', () => {
    // Node's vitest environment has no global CloseEvent, so this stands in
    // for a real CloseEvent using the same fields the browser one carries.
    const closeEventLike = Object.assign(new Event('close'), {
      code: 1006,
      reason: 'abnormal closure',
      wasClean: false,
    });

    const result = toError(closeEventLike);

    expect(result.message).toContain('code=1006');
    expect(result.message).toContain('reason=abnormal closure');
    expect(result.message).toContain('wasClean=false');
  });

  it('falls back to String() for non-Event, non-Error values', () => {
    expect(toError('plain string').message).toBe('plain string');
  });
});
