// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { apiService } from '@/services/api';
import { usePaletteSearch } from '@/hooks/usePaletteSearch';
import { PALETTE_DEBOUNCE_MS, CAP_MESSAGES } from '@/utils/paletteFilter';
import type { Channel } from '@/types';

const channel: Channel = { id: 'c1', server_id: 's1', name: 'общий', position: 0, created_at: '', updated_at: '' };
const M1 = { id: 'm1', username: 'Борис', content: 'привет мир', created_at: '2026-09-20T09:00:00Z' };
const M2 = { id: 'm2', username: 'Анна', content: 'привет всем', created_at: '2026-09-20T09:01:00Z' };
const ERR = 'сеть упала';

let search: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  search = vi.spyOn(apiService, 'searchMessages').mockResolvedValue({ results: [M1], total: 1 } as never);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(PALETTE_DEBOUNCE_MS); });

describe('usePaletteSearch', () => {
  it('inactive: empty result, no request', async () => {
    const { result } = renderHook(() => usePaletteSearch(false, channel, 'привет'));
    await flush();
    expect(result.current).toEqual({ messages: [], total: 0, loading: false, error: null });
    expect(search).not.toHaveBeenCalled();
  });

  it('no channel or a query shorter than 2 chars: empty result, no request', async () => {
    const a = renderHook(() => usePaletteSearch(true, null, 'привет'));
    const b = renderHook(() => usePaletteSearch(true, channel, 'п'));
    const c = renderHook(() => usePaletteSearch(true, channel, ''));
    await flush();
    for (const r of [a, b, c]) {
      expect(r.result.current).toEqual({ messages: [], total: 0, loading: false, error: null });
    }
    expect(search).not.toHaveBeenCalled();
  });

  it('debounces: loading straight away, exactly one request after 120 ms', async () => {
    const { result } = renderHook(() => usePaletteSearch(true, channel, 'привет'));
    expect(result.current.loading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(PALETTE_DEBOUNCE_MS - 1); });
    expect(search).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('c1', 'привет', CAP_MESSAGES, 0);
    expect(result.current).toEqual({ messages: [M1], total: 1, loading: false, error: null });
  });

  it('a query change before the timer fires cancels the previous request', async () => {
    const { result, rerender } = renderHook(({ q }) => usePaletteSearch(true, channel, q), {
      initialProps: { q: 'при' },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(PALETTE_DEBOUNCE_MS - 20); });
    search.mockResolvedValue({ results: [M2], total: 1 } as never);
    rerender({ q: 'привет' });
    await flush();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('c1', 'привет', CAP_MESSAGES, 0);
    expect(result.current.messages).toEqual([M2]);
  });

  it('a stale response that resolves after a query change is dropped', async () => {
    let resolveFirst!: (v: unknown) => void;
    search.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }) as never);
    const { result, rerender } = renderHook(({ q }) => usePaletteSearch(true, channel, q), {
      initialProps: { q: 'при' },
    });
    await flush();
    expect(search).toHaveBeenCalledTimes(1);
    search.mockResolvedValue({ results: [M2], total: 1 } as never);
    rerender({ q: 'привет' });
    await flush();
    expect(result.current.messages).toEqual([M2]);
    await act(async () => { resolveFirst({ results: [M1], total: 5 }); });
    expect(result.current.messages).toEqual([M2]);
    expect(result.current.total).toBe(1);
  });

  it('a failed request surfaces the error and stops loading', async () => {
    search.mockRejectedValue(new Error(ERR));
    const { result } = renderHook(() => usePaletteSearch(true, channel, 'привет'));
    await flush();
    expect(result.current.error).toBe(ERR);
    expect(result.current.loading).toBe(false);
    expect(result.current.messages).toEqual([]);
  });

  it('going inactive clears earlier results', async () => {
    const { result, rerender } = renderHook(({ on }) => usePaletteSearch(on, channel, 'привет'), {
      initialProps: { on: true },
    });
    await flush();
    expect(result.current.messages).toEqual([M1]);
    rerender({ on: false });
    expect(result.current).toEqual({ messages: [], total: 0, loading: false, error: null });
  });
});
