// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { COARSE_MQ, useCoarsePointer } from '@/mobile/pointer';

function stubMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const mql = {
    get matches() { return matches; },
    media: COARSE_MQ,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  const spy = vi.fn((q: string) => {
    if (q !== COARSE_MQ) throw new Error(`unexpected query ${q}`);
    return mql;
  });
  window.matchMedia = spy as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) { matches = next; listeners.forEach((l) => l()); },
    listenerCount: () => listeners.size,
  };
}

afterEach(cleanup);

describe('useCoarsePointer', () => {
  it('uses the coarse pointer query', () => {
    expect(COARSE_MQ).toBe('(pointer: coarse)');
  });

  it('reflects the initial match and follows changes', () => {
    const mm = stubMatchMedia(true);
    const { result } = renderHook(() => useCoarsePointer());
    expect(result.current).toBe(true);
    act(() => mm.set(false));
    expect(result.current).toBe(false);
  });

  it('unsubscribes on unmount', () => {
    const mm = stubMatchMedia(false);
    const { unmount } = renderHook(() => useCoarsePointer());
    expect(mm.listenerCount()).toBe(1);
    unmount();
    expect(mm.listenerCount()).toBe(0);
  });
});
