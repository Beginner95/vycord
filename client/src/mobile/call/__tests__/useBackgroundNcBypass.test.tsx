// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';

const nc = vi.hoisted(() => ({ setBackgroundBypass: vi.fn((_b: boolean) => Promise.resolve()) }));
vi.mock('@/services/noiseCancellation', () => ({ noiseCancellationService: nc }));

import { useBackgroundNcBypass } from '@/mobile/call/useBackgroundNcBypass';

let visibility: 'visible' | 'hidden' = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
const setVisibility = (v: 'visible' | 'hidden') => {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
};
const calls = () => nc.setBackgroundBypass.mock.calls.map((c) => c[0]);

beforeEach(() => { vi.clearAllMocks(); visibility = 'visible'; });
afterEach(() => cleanup());

describe('useBackgroundNcBypass', () => {
  it('hidden → bypass immediately (no debounce); visible → back', () => {
    renderHook(() => useBackgroundNcBypass(true));
    expect(calls()).toEqual([]);
    act(() => setVisibility('hidden'));
    expect(calls()).toEqual([true]);
    act(() => setVisibility('visible'));
    expect(calls()).toEqual([true, false]);
  });

  it('idempotent: repeated events do not repeat calls', () => {
    renderHook(() => useBackgroundNcBypass(true));
    act(() => { setVisibility('hidden'); setVisibility('hidden'); });
    act(() => { setVisibility('visible'); setVisibility('visible'); });
    act(() => { setVisibility('hidden'); setVisibility('visible'); });
    expect(calls()).toEqual([true, false, true, false]);
  });

  it('pagehide and call end restore the worklet', () => {
    const { unmount } = renderHook(() => useBackgroundNcBypass(true));
    act(() => setVisibility('hidden'));
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(calls()).toEqual([true, false]);
    act(() => setVisibility('hidden'));
    unmount();
    expect(calls()).toEqual([true, false, true, false]);
  });

  it('mounted while hidden → bypass at once; unmount while visible → no call', () => {
    visibility = 'hidden';
    const first = renderHook(() => useBackgroundNcBypass(true));
    expect(calls()).toEqual([true]);
    first.unmount();
    vi.clearAllMocks();
    visibility = 'visible';
    const second = renderHook(() => useBackgroundNcBypass(true));
    second.unmount();
    expect(calls()).toEqual([]);
  });

  it('disabled (no group call / not mounted on desktop) → never touches NC', () => {
    renderHook(() => useBackgroundNcBypass(false));
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(nc.setBackgroundBypass).not.toHaveBeenCalled();
  });
});
