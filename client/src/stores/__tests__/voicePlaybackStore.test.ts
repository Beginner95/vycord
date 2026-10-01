// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('voicePlaybackStore', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules(); });

  it('цикл 1 → 1.5 → 2 → 1 и запоминание', async () => {
    const { useVoicePlaybackStore } = await import('@/stores/voicePlaybackStore');
    const s = useVoicePlaybackStore;
    expect(s.getState().rate).toBe(1);
    s.getState().cycle(); expect(s.getState().rate).toBe(1.5);
    s.getState().cycle(); expect(s.getState().rate).toBe(2);
    expect(localStorage.getItem('vycord.voiceRate')).toBe('2');
    s.getState().cycle(); expect(s.getState().rate).toBe(1);
  });

  it('читает сохранённое; мусор → 1', async () => {
    localStorage.setItem('vycord.voiceRate', '1.5');
    expect((await import('@/stores/voicePlaybackStore')).useVoicePlaybackStore.getState().rate).toBe(1.5);
    vi.resetModules();
    localStorage.setItem('vycord.voiceRate', '7');
    expect((await import('@/stores/voicePlaybackStore')).useVoicePlaybackStore.getState().rate).toBe(1);
  });

  it('недоступное хранилище — не падает', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const { useVoicePlaybackStore } = await import('@/stores/voicePlaybackStore');
    expect(useVoicePlaybackStore.getState().rate).toBe(1);
    expect(() => useVoicePlaybackStore.getState().cycle()).not.toThrow();
  });
});
