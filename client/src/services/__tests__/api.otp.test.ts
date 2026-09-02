import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiService, ApiError } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import type { User } from '@/types';

const user: User = { id: '1', username: 'test', email: 't@example.com', status: 'online' } as User;

describe('apiService OTP', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
    vi.restoreAllMocks();
  });

  it('requestOtp() бьёт в /otp/request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: () => Promise.resolve({ status: 'otp_sent' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await apiService.requestOtp('t@example.com');

    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/auth/otp/request');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 't@example.com' });
  });

  it('verifyOtp() без username отправляет только email и code', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ access_token: 'a', refresh_token: 'r', user }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const data = await apiService.verifyOtp('t@example.com', '0429');

    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/auth/otp/verify');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 't@example.com', code: '0429' });
    expect('access_token' in data && data.access_token).toBe('a');
  });

  it('verifyOtp() с username включает его в тело', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ access_token: 'a', refresh_token: 'r', user }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await apiService.verifyOtp('new@example.com', '0429', 'newbie');

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      email: 'new@example.com', code: '0429', username: 'newbie',
    });
  });

  it('verifyOtp() на новый email без username возвращает username_required', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'username_required' }),
    }));

    const data = await apiService.verifyOtp('new@example.com', '0429');

    expect('status' in data && data.status).toBe('username_required');
  });

  // attempts_left приходит в теле 401 и нужен интерфейсу, чтобы показать
  // «осталось N попыток». ApiError несёт только message/code/status, поэтому
  // тело сохраняется отдельно в details.
  it('неверный код доносит code и attempts_left', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'invalid or expired code', code: 'invalid_otp', attempts_left: 2 }),
    }));

    try {
      await apiService.verifyOtp('t@example.com', '9999');
      expect.unreachable('ожидалась ошибка');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('invalid_otp');
      expect((err as ApiError).status).toBe(401);
      expect((err as ApiError).details?.attempts_left).toBe(2);
    }
  });

  it('занятый username доносит username_taken', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: 'username is taken', code: 'username_taken' }),
    }));

    await expect(apiService.verifyOtp('new@example.com', '0429', 'taken')).rejects.toMatchObject({
      code: 'username_taken',
      status: 409,
    });
  });

  it('кулдаун доносит otp_cooldown', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ error: 'too many requests', code: 'otp_cooldown' }),
    }));

    await expect(apiService.requestOtp('t@example.com')).rejects.toMatchObject({
      code: 'otp_cooldown',
      status: 429,
    });
  });
});
