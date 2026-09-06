import { describe, it, expect, vi } from 'vitest';
import { apiService } from '@/services/api';

describe('apiService last seen', () => {
  it('getLastSeenBatch() отправляет POST с user_ids и отдаёт разобранный ответ', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ u1: { last_seen_at: '2026-09-04T10:00:00Z', visible: true } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const data = await apiService.getLastSeenBatch(['u1', 'u2']);

    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/users/last-seen');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ user_ids: ['u1', 'u2'] });
    expect(data.u1.visible).toBe(true);
  });

  it('updatePrivacy() отправляет PATCH с show_last_seen', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: () => Promise.resolve({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    await apiService.updatePrivacy({ show_last_seen: false });

    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/users/me/privacy');
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ show_last_seen: false });
  });
});
