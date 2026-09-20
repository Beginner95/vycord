// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { MOBILE_MQ, useIsMobile } from '@/mobile/breakpoint';

function stubMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const mql = {
    get matches() { return matches; },
    media: MOBILE_MQ,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  const spy = vi.fn((q: string) => {
    if (q !== MOBILE_MQ) throw new Error(`unexpected query ${q}`);
    return mql;
  });
  window.matchMedia = spy as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) { matches = next; listeners.forEach((l) => l()); },
    listenerCount: () => listeners.size,
  };
}

afterEach(cleanup);

describe('useIsMobile', () => {
  it('uses the single mobile query', () => {
    expect(MOBILE_MQ).toBe('(width < 900px)');
  });

  it('reflects the initial match and follows changes', () => {
    const mm = stubMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
    act(() => mm.set(false));
    expect(result.current).toBe(false);
  });

  it('unsubscribes on unmount', () => {
    const mm = stubMatchMedia(false);
    const { unmount } = renderHook(() => useIsMobile());
    expect(mm.listenerCount()).toBe(1);
    unmount();
    expect(mm.listenerCount()).toBe(0);
  });
});
