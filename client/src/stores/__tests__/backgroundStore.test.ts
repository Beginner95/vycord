// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { apiService } from '@/services/api';

vi.mock('@/services/api', () => ({
  apiService: {
    fetchBackgrounds: vi.fn(),
  },
  API_BASE_URL: 'http://api.test',
}));

const mockedFetch = vi.mocked(apiService.fetchBackgrounds);

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  mockedFetch.mockReset();
});

describe('backgroundStore: режим и фон', () => {
  it('setMode и setBackground пишут в стор и персистятся', async () => {
    const { useBackgroundStore } = await import('@/stores/backgroundStore');
    useBackgroundStore.getState().setMode('blur');
    useBackgroundStore.getState().setBackground('ocean');
    expect(useBackgroundStore.getState().mode).toBe('blur');
    expect(useBackgroundStore.getState().backgroundId).toBe('ocean');
    expect(JSON.parse(localStorage.getItem('vycord_background')!)).toEqual({
      mode: 'blur', backgroundId: 'ocean',
    });

    vi.resetModules();
    const { useBackgroundStore: fresh } = await import('@/stores/backgroundStore');
    expect(fresh.getState().mode).toBe('blur');
    expect(fresh.getState().backgroundId).toBe('ocean');
  });

  it('невалидный localStorage не ломает init', async () => {
    localStorage.setItem('vycord_background', '{broken');
    const { useBackgroundStore } = await import('@/stores/backgroundStore');
    expect(useBackgroundStore.getState().mode).toBe('none');
    expect(useBackgroundStore.getState().backgroundId).toBeNull();
  });
});

describe('backgroundStore: fetchBackgrounds', () => {
  it('заполняет список, резолвит url и статус ready', async () => {
    mockedFetch.mockResolvedValue([
      { id: 'ocean', name: 'ocean', url: '/backgrounds/ocean/file' },
    ]);
    const { useBackgroundStore } = await import('@/stores/backgroundStore');
    await useBackgroundStore.getState().fetchBackgrounds();
    const s = useBackgroundStore.getState();
    expect(s.listStatus).toBe('ready');
    expect(s.list).toEqual([{ id: 'ocean', name: 'ocean', url: 'http://api.test/backgrounds/ocean/file' }]);
    expect(s.urlById('ocean')).toBe('http://api.test/backgrounds/ocean/file');
    expect(s.urlById('nope')).toBeNull();
  });

  it('повторный fetch при готовом списке не ходит в сеть', async () => {
    mockedFetch.mockResolvedValue([]);
    const { useBackgroundStore } = await import('@/stores/backgroundStore');
    await useBackgroundStore.getState().fetchBackgrounds();
    await useBackgroundStore.getState().fetchBackgrounds();
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('ошибка сети → listStatus error без проброса', async () => {
    mockedFetch.mockRejectedValue(new Error('net'));
    const { useBackgroundStore } = await import('@/stores/backgroundStore');
    await expect(useBackgroundStore.getState().fetchBackgrounds()).resolves.toBeUndefined();
    expect(useBackgroundStore.getState().listStatus).toBe('error');
  });
});