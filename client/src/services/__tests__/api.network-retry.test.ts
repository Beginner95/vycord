import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiService } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import type { User } from '@/types';

const user: User = { id: '1', username: 'test', email: 't@example.com', status: 'online' } as User;

function makeToken(expSeconds: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify({ user_id: '1', exp: expSeconds }));
  return `${header}.${body}.sig`;
}

// При холодном старте Electron/AppImage на Linux сетевой стек Chromium
// иногда ещё не готов принимать запросы в первые мгновения после монтирования
// приложения: fetch() бросает TypeError ("Failed to fetch") ещё до того, как
// запрос вообще ушёл на сервер (GlitchTip issue #41 — сервер не увидел эти
// запросы вовсе, ни в access-, ни в error-логе).
describe('apiService network-level retry on cold-start fetch failure', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('request(): retries once after fetch() itself rejects, and succeeds', async () => {
    useAuthStore.getState().login(makeToken(Math.floor(Date.now() / 1000) + 900), 'refresh-1', user);

    let call = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: '1' }) });
    }));

    const resultPromise = apiService.getMe();
    await vi.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).resolves.toEqual({ id: '1' });
    expect(call).toBe(2);
  });

  it('request(): propagates the error if the retry also fails (no infinite retry)', async () => {
    useAuthStore.getState().login(makeToken(Math.floor(Date.now() / 1000) + 900), 'refresh-1', user);

    let call = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      call++;
      return Promise.reject(new TypeError('Failed to fetch'));
    }));

    const resultPromise = apiService.getMe();
    resultPromise.catch(() => {});
    await vi.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).rejects.toThrow('Failed to fetch');
    expect(call).toBe(2);
  });

  it('requestForm(): retries once after fetch() itself rejects, and succeeds', async () => {
    useAuthStore.getState().login(makeToken(Math.floor(Date.now() / 1000) + 900), 'refresh-1', user);

    let call = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(user) });
    }));

    const resultPromise = apiService.removeAvatar();
    await vi.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).resolves.toEqual(user);
    expect(call).toBe(2);
  });
});
