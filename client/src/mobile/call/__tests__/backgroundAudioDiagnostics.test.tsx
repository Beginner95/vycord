// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>();
  const rawTrack = {
    addEventListener: vi.fn((type: string, h: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(h);
    }),
    removeEventListener: vi.fn((type: string, h: () => void) => { listeners.get(type)?.delete(h); }),
  };
  const ctxUnsub = vi.fn();
  let ctxListener: ((s: string) => void) | null = null;
  let packets = 0;
  const service = {
    localStreamState: { id: 'local', getAudioTracks: () => [] as unknown[] },
    getBackgroundAudioSnapshot: vi.fn(async () => ({
      chain: {
        contextState: 'running', contextTime: 1, sampleRate: 48000, baseLatency: 0.01, micGain: 1, ncActive: false, ncBypassed: true,
        rawTrack: { readyState: 'live', muted: false, enabled: true },
        destTrack: { readyState: 'live', muted: false, enabled: true },
      },
      micMuted: false, pcState: 'connected', iceState: 'connected',
      senderTrack: { readyState: 'live', muted: false, enabled: true },
      packetsSent: (packets += 50), bytesSent: packets * 100, audioLevel: 0.1, totalAudioEnergy: 0.5, totalSamplesDuration: 3,
    })),
    reportBackgroundAudio: vi.fn((_extra: Record<string, unknown>) => true),
  };
  const nc = {
    getChainDiagnostics: vi.fn(() => ({ micGain: 1 })),
    getRawAudioTrack: vi.fn(() => rawTrack),
    onChainContextStateChange: vi.fn((_id: string, l: (s: string) => void) => { ctxListener = l; return ctxUnsub; }),
  };
  return {
    service, nc, rawTrack, listeners, ctxUnsub,
    fireCtx: (s: string) => ctxListener?.(s),
    fireTrack: (type: string) => listeners.get(type)?.forEach((h) => h()),
  };
});
vi.mock('@/services/groupCall', () => ({ groupCallService: mocks.service }));
vi.mock('@/services/noiseCancellation', () => ({ noiseCancellationService: mocks.nc }));

import {
  useBackgroundAudioDiagnostics,
  BG_SNAPSHOT_SCHEDULE_S,
} from '@/mobile/call/backgroundAudioDiagnostics';

let visibility: 'visible' | 'hidden' = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
const setVisibility = (v: 'visible' | 'hidden') => {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
};
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.listeners.clear();
  visibility = 'visible';
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useBackgroundAudioDiagnostics', () => {
  it('takes snapshots on schedule while hidden and sends ONE columnar report on return', async () => {
    renderHook(() => useBackgroundAudioDiagnostics(true));
    act(() => setVisibility('hidden'));
    await advance(0);
    expect(mocks.service.getBackgroundAudioSnapshot).toHaveBeenCalledTimes(1);
    await advance(3_000);
    expect(mocks.service.getBackgroundAudioSnapshot).toHaveBeenCalledTimes(4); // 0,1,2,3
    act(() => mocks.fireTrack('mute'));
    act(() => mocks.fireCtx('suspended'));
    await advance(27_000);
    expect(mocks.service.getBackgroundAudioSnapshot).toHaveBeenCalledTimes(BG_SNAPSHOT_SCHEDULE_S.length);

    act(() => setVisibility('visible'));
    await advance(0);
    expect(mocks.service.reportBackgroundAudio).toHaveBeenCalledTimes(1);
    const extra = mocks.service.reportBackgroundAudio.mock.calls[0][0] as Record<string, unknown[]> & Record<string, unknown>;
    expect(extra.endReason).toBe('visible');
    expect(extra.snapshotCount).toBe(BG_SNAPSHOT_SCHEDULE_S.length + 1); // + снимок на возврате
    expect(extra.s_sched).toEqual([...BG_SNAPSHOT_SCHEDULE_S, -1]);
    expect(extra.s_pkts).toHaveLength(BG_SNAPSHOT_SCHEDULE_S.length + 1);
    expect(new Set(extra.s_ncBypass)).toEqual(new Set([1]));
    expect(new Set(extra.s_ncActive)).toEqual(new Set([0]));
    expect((extra.trackEvents as string[])[0]).toMatch(/^raw-mute@\d+$/);
    expect((extra.ctxEvents as string[])[0]).toMatch(/^suspended@\d+$/);

    // Никаких повторных отчётов: таймеры цикла сняты.
    await advance(60_000);
    act(() => setVisibility('visible'));
    await advance(0);
    expect(mocks.service.reportBackgroundAudio).toHaveBeenCalledTimes(1);
    expect(mocks.ctxUnsub).toHaveBeenCalled();
    expect(mocks.listeners.get('mute')?.size ?? 0).toBe(0);
  });

  it('does not report a short hidden (< 2 s)', async () => {
    renderHook(() => useBackgroundAudioDiagnostics(true));
    act(() => setVisibility('hidden'));
    await advance(1_500);
    act(() => setVisibility('visible'));
    await advance(5_000);
    expect(mocks.service.reportBackgroundAudio).not.toHaveBeenCalled();
    const calls = mocks.service.getBackgroundAudioSnapshot.mock.calls.length;
    await advance(40_000);
    expect(mocks.service.getBackgroundAudioSnapshot.mock.calls.length).toBe(calls);
  });

  it('pagehide sends the report immediately, once per cycle', async () => {
    renderHook(() => useBackgroundAudioDiagnostics(true));
    act(() => setVisibility('hidden'));
    await advance(5_000);
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(mocks.service.reportBackgroundAudio).toHaveBeenCalledTimes(1);
    expect((mocks.service.reportBackgroundAudio.mock.calls[0][0] as { endReason: string }).endReason).toBe('pagehide');
    act(() => setVisibility('visible'));
    await advance(2_000);
    expect(mocks.service.reportBackgroundAudio).toHaveBeenCalledTimes(1);
  });

  it('call end (unmount) removes listeners and timers without reporting', async () => {
    const { unmount } = renderHook(() => useBackgroundAudioDiagnostics(true));
    act(() => setVisibility('hidden'));
    await advance(1_000);
    unmount();
    const calls = mocks.service.getBackgroundAudioSnapshot.mock.calls.length;
    await advance(40_000);
    act(() => setVisibility('visible'));
    await advance(2_000);
    expect(mocks.service.getBackgroundAudioSnapshot.mock.calls.length).toBe(calls);
    expect(mocks.service.reportBackgroundAudio).not.toHaveBeenCalled();
    expect(mocks.ctxUnsub).toHaveBeenCalled();
    expect(mocks.rawTrack.removeEventListener).toHaveBeenCalled();
  });

  it('disabled (no group call) → nothing is sampled', async () => {
    renderHook(() => useBackgroundAudioDiagnostics(false));
    act(() => setVisibility('hidden'));
    await advance(10_000);
    expect(mocks.service.getBackgroundAudioSnapshot).not.toHaveBeenCalled();
  });
});
