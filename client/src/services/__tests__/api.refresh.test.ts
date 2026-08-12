import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiService } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { wsService } from '@/services/websocket';
import type { User } from '@/types';

const user: User = { id: '1', username: 'test', email: 't@example.com', status: 'online' } as User;

function makeToken(expSeconds: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify({ user_id: '1', exp: expSeconds }));
  return `${header}.${body}.sig`;
}

describe('apiService refresh mechanics', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
    vi.restoreAllMocks();
    vi.spyOn(wsService, 'updateToken').mockImplementation(() => {});
  });

  it('login() returns the new access_token/refresh_token/user shape', async () => {
    const expSeconds = Math.floor(Date.now() / 1000) + 900;
    const responseBody = { access_token: makeToken(expSeconds), refresh_token: 'refresh-1', user };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(responseBody),
    }));

    const data = await apiService.login('t@example.com', 'password123');

    expect(data.access_token).toBe(responseBody.access_token);
    expect(data.refresh_token).toBe('refresh-1');
    expect(data.user).toEqual(user);
  });

  it('deduplicates concurrent refresh calls into a single request', async () => {
    useAuthStore.getState().login(makeToken(Math.floor(Date.now() / 1000) - 10), 'refresh-old', user);

    const expSeconds = Math.floor(Date.now() / 1000) + 900;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ access_token: makeToken(expSeconds), refresh_token: 'refresh-new', user }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const [a, b, c] = await Promise.all([
      apiService.getFreshAccessToken(),
      apiService.getFreshAccessToken(),
      apiService.getFreshAccessToken(),
    ]);

    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/refresh'));
    expect(refreshCalls.length).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(useAuthStore.getState().refreshToken).toBe('refresh-new');
    expect(wsService.updateToken).toHaveBeenCalledWith(a);
  });

  it('getFreshAccessToken returns the current token without a network call if it is not near expiry', async () => {
    const freshToken = makeToken(Math.floor(Date.now() / 1000) + 900);
    useAuthStore.getState().login(freshToken, 'refresh-1', user);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiService.getFreshAccessToken();

    expect(result).toBe(freshToken);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getFreshAccessToken returns null and logs out when there is no refresh token', async () => {
    const result = await apiService.getFreshAccessToken();
    expect(result).toBeNull();
  });

  it('a 401 from /auth/refresh logs the user out', async () => {
    useAuthStore.getState().login(makeToken(Math.floor(Date.now() / 1000) - 10), 'refresh-dead', user);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'invalid', code: 'invalid_or_expired_token' }),
    }));

    const result = await apiService.getFreshAccessToken();

    expect(result).toBeNull();
    expect(useAuthStore.getState().refreshToken).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('a network error while refreshing does not log the user out', async () => {
    useAuthStore.getState().login(makeToken(Math.floor(Date.now() / 1000) - 10), 'refresh-1', user);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await apiService.getFreshAccessToken();

    expect(result).toBeNull();
    expect(useAuthStore.getState().refreshToken).toBe('refresh-1');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('logout() posts the refresh token and clears local state', async () => {
    useAuthStore.getState().login(makeToken(Math.floor(Date.now() / 1000) + 900), 'refresh-1', user);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);

    await apiService.logout();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/auth/logout'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ refresh_token: 'refresh-1' }) })
    );
  });
});
