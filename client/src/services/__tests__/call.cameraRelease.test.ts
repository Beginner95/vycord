import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callService } from '@/services/call';

// Звонок 1:1: камера «выкл» освобождает устройство (индикатор «камера
// используется» гаснет), «вкл» — захватывает её заново.

interface FakeTrack {
  kind: string;
  enabled: boolean;
  readyState: 'live' | 'ended';
  stop: () => void;
}

function track(kind: string, enabled = true): FakeTrack {
  const t: FakeTrack = {
    kind,
    enabled,
    readyState: 'live',
    stop: vi.fn(() => { t.readyState = 'ended'; }),
  };
  return t;
}

function stream(tracks: FakeTrack[]) {
  const list = [...tracks];
  return {
    id: 'local',
    getVideoTracks: () => list.filter((t) => t.kind === 'video'),
    getAudioTracks: () => list.filter((t) => t.kind === 'audio'),
    getTracks: () => list,
    addTrack: vi.fn((t: FakeTrack) => { list.push(t); }),
    removeTrack: vi.fn((t: FakeTrack) => { list.splice(list.indexOf(t), 1); }),
  };
}

type Internals = {
  localStream: unknown;
  peerConnection: unknown;
  cameraTrack: unknown;
  cameraPlaceholder: unknown;
  cameraEffectWanted: boolean;
  callbacks: unknown;
};
const internals = callService as unknown as Internals;

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe('callService — camera off frees the device', () => {
  let cam: FakeTrack;
  let local: ReturnType<typeof stream>;
  let sender: { track: unknown; replaceTrack: ReturnType<typeof vi.fn> };
  let placeholders: FakeTrack[];
  let gum: ReturnType<typeof vi.fn>;
  let onCameraFailed: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cam = track('video', true);
    local = stream([track('audio'), cam]);
    sender = { track: cam, replaceTrack: vi.fn(async (t: unknown) => { sender.track = t; }) };
    internals.localStream = local;
    internals.peerConnection = { getSenders: () => [sender] };
    internals.cameraTrack = cam;
    internals.cameraPlaceholder = null;
    internals.cameraEffectWanted = false;
    onCameraFailed = vi.fn();
    internals.callbacks = { onCameraFailed };
    placeholders = [];
    // Без DOM: canvas чёрной заглушки подделывается.
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => null,
        captureStream: () => {
          const p = track('video');
          placeholders.push(p);
          return stream([p]);
        },
      }),
    });
    gum = vi.fn(async () => stream([track('video')]));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: gum } });
  });

  afterEach(() => {
    internals.localStream = null;
    internals.peerConnection = null;
    internals.cameraTrack = null;
    internals.cameraPlaceholder = null;
    internals.cameraEffectWanted = false;
    internals.callbacks = null;
    vi.unstubAllGlobals();
  });

  it('off stops the camera behind a black placeholder; on re-captures and sends it', async () => {
    expect(callService.toggleMuteVideo()).toBe(true);
    await settle();
    expect(cam.stop).toHaveBeenCalled();
    expect(sender.track).toBe(placeholders[0]);
    expect(callService.cameraInputState).toBeNull();

    expect(callService.toggleMuteVideo()).toBe(false);
    await settle();
    const fresh = local.getVideoTracks()[0];
    expect(fresh).not.toBe(cam);
    expect(fresh.readyState).toBe('live');
    expect(fresh.enabled).toBe(true);
    expect(sender.track).toBe(fresh);
    expect(placeholders[0].stop).toHaveBeenCalled();
  });

  it('a failed re-capture turns the camera back off and reports it', async () => {
    callService.toggleMuteVideo();
    await settle();
    gum.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));

    callService.toggleMuteVideo();
    await settle();

    expect(onCameraFailed).toHaveBeenCalledTimes(1);
    expect(cam.enabled).toBe(false);
    expect(sender.track).toBe(placeholders[0]);
  });

  it('with an effect on, the re-captured camera waits for the effect canvas', async () => {
    callService.setCameraEffectWanted(true);
    callService.toggleMuteVideo();
    await settle();
    callService.toggleMuteVideo();
    await settle();
    expect(sender.track).toBe(placeholders[0]);

    const canvas = track('video');
    await callService.setCameraOutput(canvas as unknown as MediaStreamTrack);
    expect(sender.track).toBe(canvas);
    expect(local.getVideoTracks()).toEqual([canvas]);
    expect(placeholders[0].stop).toHaveBeenCalled();
  });
});
