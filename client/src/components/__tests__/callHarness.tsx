import { vi } from 'vitest';
import type { RemoteParticipant } from '@/stores/callStore';

export function stubBrowser(): void {
  process.env.TZ = 'UTC';
  window.matchMedia = vi.fn((q: string) => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  // CallStage измеряет getBoundingClientRect для тултипов/поповеров — jsdom
  // возвращает нули по умолчанию, этого достаточно (снимок не зависит от чисел).
  Element.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true, writable: true });
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
}

export function participant(userId: string, over: Partial<RemoteParticipant> = {}): RemoteParticipant {
  return { userId, stream: null, ...over };
}
