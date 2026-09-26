// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiService } from '@/services/api';

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })));
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('apiService.fetchBackgrounds', () => {
  it('разбирает ответ сервера в список фонов', async () => {
    stubFetch({ backgrounds: [
      { id: 'ocean', name: 'ocean', url: '/backgrounds/ocean/file' },
      { id: 'alps', name: 'alps', url: '/backgrounds/alps/file' },
    ] });
    const list = await apiService.fetchBackgrounds();
    expect(list).toEqual([
      { id: 'ocean', name: 'ocean', url: '/backgrounds/ocean/file' },
      { id: 'alps', name: 'alps', url: '/backgrounds/alps/file' },
    ]);
  });

  it('пустой список — это []', async () => {
    stubFetch({ backgrounds: [] });
    await expect(apiService.fetchBackgrounds()).resolves.toEqual([]);
  });

  it('пробрасывает ApiError на ошибку сервера', async () => {
    stubFetch({ error: 'boom', code: 'internal' }, 500);
    await expect(apiService.fetchBackgrounds()).rejects.toMatchObject({ code: 'internal' });
  });
});