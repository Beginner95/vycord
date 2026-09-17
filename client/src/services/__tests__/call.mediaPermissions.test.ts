import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callService } from '@/services/call';

describe('callService media-permission pre-flight', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')),
      },
    });
  });

  it('surfaces the translated permission-denied message via onError when macOS reports denied', async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getMediaAccessStatus: vi.fn().mockResolvedValue({ camera: 'denied', microphone: 'denied' }),
    };
    const onError = vi.fn();
    callService.init({ onRemoteStream: () => {}, onCallEnded: () => {}, onError });

    await callService.startCall('peer-1');

    expect(onError).toHaveBeenCalledWith(
      expect.stringMatching(/camera and microphone access is denied|Доступ к камере и микрофону запрещён/i),
    );

    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('does not call onError proactively when there is no electronAPI bridge (web build)', async () => {
    const onError = vi.fn();
    callService.init({ onRemoteStream: () => {}, onCallEnded: () => {}, onError });

    await callService.startCall('peer-1');

    // getUserMedia still fails in this test's stub, so onError WILL fire —
    // but with the raw browser message, not the proactive translated one.
    expect(onError).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalledWith(
      expect.stringMatching(/camera and microphone access is denied|Доступ к камере и микрофону запрещён/i),
    );
  });
});
