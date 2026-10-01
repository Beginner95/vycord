import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { groupCallService } from '@/services/groupCall';
import { noiseCancellationService } from '@/services/noiseCancellation';

// Камера «выкл» освобождает устройство (индикатор «камера используется» в
// браузере гаснет), «вкл» — захватывает её заново. Выключенный, но живой трек
// индикатор не гасит: браузер продолжает захват.

interface FakeTrack {
  id: string;
  kind: string;
  enabled: boolean;
  readyState: 'live' | 'ended';
  muted: boolean;
  stop: () => void;
}

function track(kind: string, enabled = true): FakeTrack {
  const t: FakeTrack = {
    id: `${kind}-${Math.random().toString(36).slice(2, 10)}`,
    kind,
    enabled,
    readyState: 'live',
    muted: false,
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
  pc: unknown;
  cameraTrack: unknown;
  cameraPlaceholder: unknown;
  cameraEffectWanted: boolean;
  callbacks: unknown;
  createDummyVideoTrack: () => FakeTrack;
};
const internals = groupCallService as unknown as Internals;

/** Lets the camera queue (syncCamera → release/reacquire) run to completion. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe('groupCallService — camera off frees the device', () => {
  let cam: FakeTrack;
  let local: ReturnType<typeof stream>;
  let sender: { track: unknown; replaceTrack: ReturnType<typeof vi.fn> };
  let placeholders: FakeTrack[];
  let gum: ReturnType<typeof vi.fn>;
  let onCameraFailed: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cam = track('video', true); // камера включена
    local = stream([track('audio'), cam]);
    sender = { track: cam, replaceTrack: vi.fn(async (t: unknown) => { sender.track = t; }) };
    internals.localStream = local;
    internals.pc = { getSenders: () => [sender] };
    internals.cameraTrack = cam;
    internals.cameraPlaceholder = null;
    internals.cameraEffectWanted = false;
    onCameraFailed = vi.fn();
    internals.callbacks = { onCameraFailed };
    placeholders = [];
    vi.spyOn(internals, 'createDummyVideoTrack').mockImplementation(() => {
      const p = track('video', false);
      placeholders.push(p);
      return p;
    });
    gum = vi.fn(async () => stream([track('video')]));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: gum } });
  });

  afterEach(() => {
    internals.localStream = null;
    internals.pc = null;
    internals.cameraTrack = null;
    internals.cameraPlaceholder = null;
    internals.cameraEffectWanted = false;
    internals.callbacks = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('turning the camera off stops the track and puts a placeholder on the sender', async () => {
    expect(groupCallService.toggleMuteVideo()).toBe(true);
    await settle();

    expect(cam.stop).toHaveBeenCalled();
    expect(sender.track).toBe(placeholders[0]);
    // Трек остаётся в localStream: «камера есть» и слот реконнекта живы.
    expect(local.getVideoTracks()).toEqual([cam]);
    expect(groupCallService.cameraInputState).toBeNull();
  });

  it('turning it back on re-captures the camera and sends it, enabled', async () => {
    groupCallService.toggleMuteVideo();
    await settle();

    expect(groupCallService.toggleMuteVideo()).toBe(false);
    await settle();

    expect(gum).toHaveBeenCalledTimes(1);
    const fresh = local.getVideoTracks()[0];
    expect(fresh).not.toBe(cam);
    expect(fresh.readyState).toBe('live');
    expect(fresh.enabled).toBe(true);
    expect(sender.track).toBe(fresh);
    expect(placeholders[0].stop).toHaveBeenCalled();
    expect(internals.cameraTrack).toBe(fresh);
  });

  it('rapid off/on/off ends released, with no live camera left behind', async () => {
    groupCallService.toggleMuteVideo(); // off
    await settle();
    groupCallService.toggleMuteVideo(); // on — getUserMedia in flight
    groupCallService.toggleMuteVideo(); // off again before it resolves
    await settle();

    const video = local.getVideoTracks();
    expect(video).toHaveLength(1);
    expect(video[0].enabled).toBe(false);
    expect(video[0].readyState).toBe('ended');
    // Каждый захваченный трек остановлен — устройство свободно.
    for (const result of gum.mock.results) {
      const s = await (result.value as Promise<ReturnType<typeof stream>>);
      expect(s.getVideoTracks()[0].readyState).toBe('ended');
    }
  });

  it('with a background effect on, off stops the raw camera, not the effect canvas', async () => {
    const canvas = track('video', true);
    local.removeTrack(cam);
    local.addTrack(canvas);
    sender.track = canvas;

    groupCallService.toggleMuteVideo();
    await settle();

    expect(cam.stop).toHaveBeenCalled();
    expect(canvas.stop).not.toHaveBeenCalled();
    expect(sender.track).toBe(placeholders[0]);
  });

  it('a failed re-capture turns the camera back off and reports it', async () => {
    groupCallService.toggleMuteVideo();
    await settle();
    gum.mockRejectedValueOnce(new DOMException('busy', 'NotReadableError'));

    groupCallService.toggleMuteVideo();
    await settle();

    expect(onCameraFailed).toHaveBeenCalledTimes(1);
    expect(local.getVideoTracks()).toEqual([cam]);
    expect(cam.enabled).toBe(false);
    expect(sender.track).toBe(placeholders[0]);
  });

  it('re-capture falls back to any camera when the selected one is gone', async () => {
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    useMediaDeviceStore.setState((s) => ({ selected: { ...s.selected, videoinput: 'gone-cam' } }));
    gum.mockRejectedValueOnce(new DOMException('gone', 'OverconstrainedError'));
    try {
      groupCallService.toggleMuteVideo();
      await settle();
      groupCallService.toggleMuteVideo();
      await settle();

      expect(gum).toHaveBeenNthCalledWith(1, { video: { deviceId: { exact: 'gone-cam' } } });
      expect(gum).toHaveBeenNthCalledWith(2, { video: true });
      expect(local.getVideoTracks()[0].readyState).toBe('live');
      expect(onCameraFailed).not.toHaveBeenCalled();
    } finally {
      useMediaDeviceStore.setState((s) => ({ selected: { ...s.selected, videoinput: '' } }));
    }
  });

  describe('background effect on', () => {
    it('a re-captured camera waits behind the placeholder for the effect canvas', async () => {
      groupCallService.setCameraEffectWanted(true);
      groupCallService.toggleMuteVideo();
      await settle();
      groupCallService.toggleMuteVideo();
      await settle();

      const fresh = local.getVideoTracks()[0];
      expect(fresh.readyState).toBe('live');
      // Сырая камера в эфир не ушла — на отправителе всё ещё заглушка.
      expect(sender.track).toBe(placeholders[0]);

      const canvas = track('video', true);
      await groupCallService.setCameraOutput(canvas as unknown as MediaStreamTrack);

      expect(sender.track).toBe(canvas);
      expect(local.getVideoTracks()).toEqual([canvas]);
      expect(canvas.enabled).toBe(true);
      expect(placeholders[0].stop).toHaveBeenCalled();
    });

    it('the effect going away puts the waiting camera itself out', async () => {
      groupCallService.setCameraEffectWanted(true);
      groupCallService.toggleMuteVideo();
      await settle();
      groupCallService.toggleMuteVideo();
      await settle();
      expect(sender.track).toBe(placeholders[0]);

      groupCallService.setCameraEffectWanted(false);
      await settle();

      expect(sender.track).toBe(local.getVideoTracks()[0]);
      expect(placeholders[0].stop).toHaveBeenCalled();
    });
  });
});

describe('groupCallService — join', () => {
  afterEach(() => {
    groupCallService.leaveGroupCall();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('frees the camera right after capture, before the audio chain is built', async () => {
    const mic = track('audio');
    const video = track('video');
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => stream([mic, video])),
        enumerateDevices: vi.fn(async () => []),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    let videoAtChain: { readyState: string; enabled: boolean } | null = null;
    vi.spyOn(noiseCancellationService, 'createChain').mockImplementation(async (raw: MediaStream) => {
      const v = raw.getVideoTracks()[0];
      videoAtChain = { readyState: v.readyState, enabled: v.enabled };
      return raw;
    });

    // connect() дальше упадёт без сети — тесту нужен только захват медиа.
    await groupCallService.joinGroupCall('room-1', 'user-1').catch(() => {});

    expect(video.stop).toHaveBeenCalled();
    expect(videoAtChain).toEqual({ readyState: 'ended', enabled: false });
  });
});

describe('groupCallService — camera slot [1] on a new PeerConnection', () => {
  type PcInternals = {
    localStream: unknown;
    cameraPlaceholder: FakeTrack | null;
    createPeerConnection: () => unknown;
    createDummyVideoTrack: () => FakeTrack;
    createMicDummyAudioTrack: () => FakeTrack;
    createDummyAudioTrack: () => FakeTrack;
  };
  const svc = groupCallService as unknown as PcInternals;
  let added: FakeTrack[];
  let placeholders: FakeTrack[];

  beforeEach(() => {
    added = [];
    placeholders = [];
    class FakePc {
      addTrack(t: FakeTrack) { added.push(t); return { track: t }; }
      getTransceivers() { return []; }
      getSenders() { return []; }
      close() {}
    }
    vi.stubGlobal('RTCPeerConnection', FakePc);
    vi.stubGlobal('RTCRtpSender', { getCapabilities: () => ({ codecs: [] }) });
    vi.stubGlobal('MediaStream', class { constructor(public tracks: unknown[] = []) {} });
    vi.spyOn(svc, 'createDummyVideoTrack').mockImplementation(() => {
      const p = track('video', false);
      placeholders.push(p);
      return p;
    });
    vi.spyOn(svc, 'createMicDummyAudioTrack').mockImplementation(() => track('audio'));
    vi.spyOn(svc, 'createDummyAudioTrack').mockImplementation(() => track('audio'));
  });

  afterEach(() => {
    svc.localStream = null;
    svc.cameraPlaceholder = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('a released camera gets an enabled placeholder in slot [1], primed with frames', () => {
    const cam = track('video', false);
    cam.stop();
    const mic = track('audio');
    svc.localStream = stream([mic, cam]);

    svc.createPeerConnection();

    // [0] mic, [1] camera slot, [2] screen video, [3] screen audio.
    expect(added).toHaveLength(4);
    expect(added[0]).toBe(mic);
    expect(added[1]).toBe(placeholders[0]);
    expect(added[1]).not.toBe(cam);
    expect(added[1].enabled).toBe(true);
    expect(svc.cameraPlaceholder).toBe(placeholders[0]);
  });

  it('a live camera goes into slot [1] itself', () => {
    const cam = track('video', true);
    svc.localStream = stream([track('audio'), cam]);

    svc.createPeerConnection();

    expect(added[1]).toBe(cam);
    expect(svc.cameraPlaceholder).toBeNull();
  });
});
