// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { apiService } from '@/services/api';
import { useSelfHealingSrc } from '@/hooks/useSelfHealingSrc';

describe('useSelfHealingSrc', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('на ошибке один раз берёт свежую подпись', async () => {
    const spy = vi.spyOn(apiService, 'getAttachment').mockResolvedValue({ id: 'a', url: '/fresh' } as never);
    const { result } = renderHook(() => useSelfHealingSrc('a', '/stale'));
    await act(async () => { result.current.onError(); });
    await waitFor(() => expect(result.current.src).toMatch(/\/fresh$/));
    await act(async () => { result.current.onError(); });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('blob:-URL не чинится', async () => {
    const spy = vi.spyOn(apiService, 'getAttachment');
    const { result } = renderHook(() => useSelfHealingSrc('pending-1-voice', 'blob:x'));
    await act(async () => { result.current.onError(); });
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.src).toBe('blob:x');
  });
});
