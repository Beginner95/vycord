import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiService } from '@/services/api';
import { useAuthStore, ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY } from '@/stores/authStore';
import { fireTestEvent } from '@/test/setup';
import type { User } from '@/types';

const user: User = { id: '1', username: 'test', email: 't@example.com', status: 'online' } as User;

function makeToken(expSeconds: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify({ user_id: '1', exp: expSeconds }));
  return `${header}.${body}.sig`;
}

describe('apiService.initAuthLifecycle', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
    vi.restoreAllMocks();
  });

  it('does nothing at startup when the user is not logged in', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    apiService.initAuthLifecycle();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('syncs tokens from another tab on a storage event', () => {
    useAuthStore.getState().login(makeToken(Math.floor(Date.now() / 1000) + 900), 'refresh-1', user);
    apiService.initAuthLifecycle();

    localStorage.setItem(ACCESS_TOKEN_KEY, 'from-other-tab-access');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'from-other-tab-refresh');
    fireTestEvent('window', 'storage', { key: ACCESS_TOKEN_KEY });

    expect(useAuthStore.getState().accessToken).toBe('from-other-tab-access');
    expect(useAuthStore.getState().refreshToken).toBe('from-other-tab-refresh');
  });

  it('refreshes on becoming visible if the access token is stale', async () => {
    useAuthStore.getState().login(makeToken(Math.floor(Date.now() / 1000) - 10), 'refresh-1', user);
    const freshToken = makeToken(Math.floor(Date.now() / 1000) + 900);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ access_token: freshToken, refresh_token: 'refresh-2', user }),
    });
    vi.stubGlobal('fetch', fetchMock);

    apiService.initAuthLifecycle();
    fireTestEvent('document', 'visibilitychange');
    await vi.waitFor(() => expect(useAuthStore.getState().accessToken).toBe(freshToken));
  });
});
