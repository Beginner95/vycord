import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiService } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import type { User } from '@/types';

const user: User = { id: '1', username: 'test', email: 't@example.com', status: 'online' } as User;

function makeToken(expSeconds: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify({ user_id: '1', exp: expSeconds }));
  return `${header}.${body}.sig`;
}

describe('apiService request() 401 retry', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
    vi.restoreAllMocks();
  });

  it('retries once after a successful refresh on invalid_or_expired_token', async () => {
    useAuthStore.getState().login(makeToken(Math.floor(Date.now() / 1000) - 10), 'refresh-old', user);

    const freshToken = makeToken(Math.floor(Date.now() / 1000) + 900);
    let call = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      call++;
      if (String(url).includes('/auth/refresh')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ access_token: freshToken, refresh_token: 'refresh-new', user }),
        });
      }
      if (call === 1) {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'expired', code: 'invalid_or_expired_token' }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: '1' }) });
    }));

    const result = await apiService.getMe();

    expect(result).toEqual({ id: '1' });
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('retries once after a successful refresh on invalid_or_expired_token (requestForm() path)', async () => {
    useAuthStore.getState().login(makeToken(Math.floor(Date.now() / 1000) - 10), 'refresh-old', user);

    const freshToken = makeToken(Math.floor(Date.now() / 1000) + 900);
    let call = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      call++;
      if (String(url).includes('/auth/refresh')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ access_token: freshToken, refresh_token: 'refresh-new', user }),
        });
      }
      if (call === 1) {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'expired', code: 'invalid_or_expired_token' }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(user) });
    }));

    const result = await apiService.removeAvatar();

    expect(result).toEqual(user);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('retries after a missing_auth_header 401 (empty/absent access token), not just invalid_or_expired_token', async () => {
    // Сценарий: accessToken пуст (bootstrap-гонка, ручное удаление и т.п.),
    // Authorization-заголовок вообще не отправляется — сервер отвечает
    // другим кодом, чем "истёк". Раньше это уходило прямо в logout().
    useAuthStore.getState().login('', 'refresh-old', user);

    const freshToken = makeToken(Math.floor(Date.now() / 1000) + 900);
    let call = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      call++;
      if (String(url).includes('/auth/refresh')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ access_token: freshToken, refresh_token: 'refresh-new', user }),
        });
      }
      if (call === 1) {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'missing', code: 'missing_auth_header' }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: '1' }) });
    }));

    const result = await apiService.getMe();

    expect(result).toEqual({ id: '1' });
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('does not retry a second time and logs out if the retried request is still 401', async () => {
    useAuthStore.getState().login(makeToken(Math.floor(Date.now() / 1000) - 10), 'refresh-old', user);

    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/auth/refresh')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ access_token: makeToken(Math.floor(Date.now() / 1000) + 900), refresh_token: 'refresh-new', user }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'still invalid', code: 'invalid_or_expired_token' }),
      });
    }));

    await expect(apiService.getMe()).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('logs out immediately on a 401 that is not invalid_or_expired_token, without calling refresh', async () => {
    useAuthStore.getState().login(makeToken(Math.floor(Date.now() / 1000) + 900), 'refresh-1', user);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'nope', code: 'some_other_code' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiService.getMe()).rejects.toMatchObject({ status: 401 });

    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/refresh'));
    expect(refreshCalls.length).toBe(0);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
