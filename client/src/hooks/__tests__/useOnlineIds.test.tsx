// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { apiService } from '@/services/api';
import { wsService } from '@/services/websocket';
import { useOnlineIds } from '@/hooks/useOnlineIds';

describe('useOnlineIds', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('загружает снимок онлайн-пользователей при монтировании', async () => {
    vi.spyOn(apiService, 'getOnlineUsers').mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);

    const { result } = renderHook(() => useOnlineIds());

    await waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.has('u1')).toBe(true);
    expect(result.current.has('u2')).toBe(true);
  });

  it('подписывается на все четыре события и перезапрашивает снимок по каждому', async () => {
    const spy = vi.spyOn(apiService, 'getOnlineUsers')
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ id: 'u3' }]);
    const onSpy = vi.spyOn(wsService, 'on');

    renderHook(() => useOnlineIds());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    const subscribedEvents = onSpy.mock.calls.map(([eventType]) => eventType);
    expect(subscribedEvents.sort()).toEqual(
      ['online_users', 'user_joined', 'user_left', 'user_updated'].sort(),
    );

    // Триггерим каждый зарегистрированный колбэк напрямую — wsService.on
    // здесь только регистрирует слушателей в Map, реального сокета не нужно.
    for (const [, listener] of onSpy.mock.calls) {
      listener({});
    }

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(5));
  });

  it('ошибку сети глотает, не роняя рендер', async () => {
    vi.spyOn(apiService, 'getOnlineUsers').mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useOnlineIds());

    await waitFor(() => expect(apiService.getOnlineUsers).toHaveBeenCalled());
    expect(result.current.size).toBe(0);
  });
});
