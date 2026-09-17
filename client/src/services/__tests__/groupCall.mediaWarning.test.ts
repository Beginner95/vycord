import { describe, it, expect, vi, afterEach } from 'vitest';
import { groupCallService } from '@/services/groupCall';

describe('groupCallService media warning', () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('is null before any join attempt', () => {
    expect(groupCallService.lastMediaWarningState).toBeNull();
  });

  it('is set to the permission-denied message when macOS TCC denies both devices', async () => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      getMediaAccessStatus: vi.fn().mockResolvedValue({ camera: 'denied', microphone: 'denied' }),
    };
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) },
    });

    // joinGroupCall does a lot (WebSocket, RTCPeerConnection) that this
    // narrow test doesn't need to succeed — it only needs acquireMedia's
    // pre-flight check to run, which happens before any network I/O.
    await groupCallService.joinGroupCall('room-1', 'user-1').catch(() => {});

    expect(groupCallService.lastMediaWarningState).toMatch(
      /camera and microphone access is denied|Доступ к камере и микрофону запрещён/i,
    );
  });
});
