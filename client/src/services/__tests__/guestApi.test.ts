import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guestApi } from '../guestApi';
import { ApiError } from '../api';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  guestApi.setSessionToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe('guestApi', () => {
  it('sends the secret in the body, never in the URL', async () => {
    fetchMock.mockReturnValue(jsonResponse({ server_name: 'S', channel_name: 'c', participant_count: 2 }));

    await guestApi.preview('s3cr3t');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/v1/guest/preview');
    expect(String(url)).not.toContain('s3cr3t');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ secret: 's3cr3t' });
    expect((init as RequestInit).headers).not.toHaveProperty('Authorization');
  });

  it('stores the session token and sends it as a bearer', async () => {
    fetchMock.mockReturnValue(jsonResponse({ guest_id: 'g', session_token: 'tok', display_name: 'Вася' }));
    const joined = await guestApi.join('s3cr3t', 'Вася');
    expect(joined.session_token).toBe('tok');
    expect(guestApi.sessionToken()).toBe('tok');

    fetchMock.mockReturnValue(jsonResponse({ token: 'room-token', room_id: 'room' }));
    await guestApi.voiceToken();
    const [, init] = fetchMock.mock.calls[1];
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('turns an error body into ApiError with the server code', async () => {
    fetchMock.mockReturnValue(jsonResponse({ error: 'guest link invalid', code: 'guest_link_invalid' }, 404));

    await expect(guestApi.preview('nope')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'guest_link_invalid',
      status: 404,
    });
    await expect(guestApi.preview('nope')).rejects.toBeInstanceOf(ApiError);
  });

  it('maps TURN credentials into ICE servers with STUN fallback', async () => {
    fetchMock.mockReturnValue(jsonResponse({
      ice_servers: [{ urls: ['turn:turn.example:3478'], username: 'u', credential: 'c' }],
      ttl: 3600,
    }));
    guestApi.setSessionToken('tok');

    const servers = await guestApi.iceServers();
    expect(servers.some((s) => String(s.urls).startsWith('stun:'))).toBe(true);
    expect(servers).toContainEqual({ urls: ['turn:turn.example:3478'], username: 'u', credential: 'c' });
  });

  it('falls back to STUN when TURN is unavailable', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    guestApi.setSessionToken('tok');
    const servers = await guestApi.iceServers();
    expect(servers.length).toBeGreaterThan(0);
    expect(servers.every((s) => String(s.urls).startsWith('stun:'))).toBe(true);
  });
});
