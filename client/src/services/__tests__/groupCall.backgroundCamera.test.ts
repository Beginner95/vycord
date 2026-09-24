import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { groupCallService } from '@/services/groupCall';
import { noiseCancellationService } from '@/services/noiseCancellation';

// VYC-96: освобождение камеры при сворачивании мобильного приложения и её
// повторный захват на возврате (вызываются только из useBackgroundCamera).

interface FakeTrack {
  kind: string;
  enabled: boolean;
  readyState: 'live' | 'ended';
  muted: boolean;
  stop: () => void;
}

function track(kind: string, enabled = true): FakeTrack {
  const t: FakeTrack = {
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

type Internals = { localStream: unknown; pc: unknown; _isScreenSharing: boolean; micRebuildInFlight: boolean };
const internals = groupCallService as unknown as Internals;

describe('groupCallService — background camera (VYC-96)', () => {
  let cam: FakeTrack;
  let local: ReturnType<typeof stream>;
  let sender: { track: unknown; replaceTrack: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    cam = track('video', false); // уже выключена обычным путём (toggleMuteVideo)
    local = stream([track('audio'), cam]);
    sender = { track: cam, replaceTrack: vi.fn(async (t: unknown) => { sender.track = t; }) };
    internals.localStream = local;
    internals.pc = { getSenders: () => [sender] };
    internals._isScreenSharing = false;
  });

  afterEach(() => {
    internals.localStream = null;
    internals.pc = null;
    vi.unstubAllGlobals();
  });

  it('release stops the camera track (frees the device) and keeps it in localStream', async () => {
    await groupCallService.releaseCameraForBackground();
    expect(cam.stop).toHaveBeenCalled();
    expect(local.getVideoTracks()).toEqual([cam]);
  });

  it('release is a no-op while the camera is still enabled or during a screen share', async () => {
    cam.enabled = true;
    await groupCallService.releaseCameraForBackground();
    expect(cam.stop).not.toHaveBeenCalled();

    cam.enabled = false;
    internals._isScreenSharing = true;
    await groupCallService.releaseCameraForBackground();
    expect(cam.stop).not.toHaveBeenCalled();
  });

  it('reacquire re-captures an ended track, swaps it on the sender and in localStream, left disabled', async () => {
    await groupCallService.releaseCameraForBackground();
    const fresh = track('video', true);
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn(async () => stream([fresh])) },
    });

    const ok = await groupCallService.reacquireCameraAfterBackground();

    expect(ok).toBe(true);
    expect(sender.replaceTrack).toHaveBeenLastCalledWith(fresh);
    expect(local.getVideoTracks()).toEqual([fresh]);
    expect(fresh.enabled).toBe(false); // включает вызывающий — через toggleMuteVideo
    expect(groupCallService.toggleMuteVideo()).toBe(false);
    expect(fresh.enabled).toBe(true);
  });

  it('release racing a resume: camera restored on the sender, not stopped, placeholder dropped', async () => {
    const placeholder = track('video', true);
    vi.spyOn(groupCallService as unknown as { createDummyVideoTrack: () => FakeTrack }, 'createDummyVideoTrack')
      .mockReturnValue(placeholder);
    let release!: () => void;
    sender.replaceTrack.mockImplementationOnce((t: unknown) => new Promise<void>((r) => {
      release = () => { sender.track = t; r(); };
    }));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } });

    const pending = groupCallService.releaseCameraForBackground();
    // Пока release ждёт replaceTrack, приложение вернулось: reacquire + toggle.
    expect(await groupCallService.reacquireCameraAfterBackground()).toBe(true);
    expect(groupCallService.toggleMuteVideo()).toBe(false);
    release();
    await pending;

    expect(cam.stop).not.toHaveBeenCalled();
    expect(cam.readyState).toBe('live');
    expect(sender.track).toBe(cam);
    expect(placeholder.stop).toHaveBeenCalled();
    // Заглушка не запомнена: следующий release снова её ставит.
    expect((groupCallService as unknown as { cameraPlaceholder: unknown }).cameraPlaceholder).toBeNull();
  });

  it('reacquire keeps a live track without calling getUserMedia', async () => {
    const gum = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: gum } });
    const ok = await groupCallService.reacquireCameraAfterBackground();
    expect(ok).toBe(true);
    expect(gum).not.toHaveBeenCalled();
    expect(local.getVideoTracks()).toEqual([cam]);
  });

  it('reacquire propagates a getUserMedia failure and leaves localStream untouched', async () => {
    await groupCallService.releaseCameraForBackground();
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn(async () => { throw new DOMException('busy', 'NotReadableError'); }) },
    });
    await expect(groupCallService.reacquireCameraAfterBackground()).rejects.toThrow();
    expect(local.getVideoTracks()).toEqual([cam]);
  });

  it('reacquire drops the fresh track if the call went away meanwhile', async () => {
    await groupCallService.releaseCameraForBackground();
    const fresh = track('video', true);
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          internals.localStream = null; // звонок закончился во время захвата
          return stream([fresh]);
        }),
      },
    });
    expect(await groupCallService.reacquireCameraAfterBackground()).toBe(false);
    expect(fresh.stop).toHaveBeenCalled();
  });
});

describe('groupCallService — mic check after foreground (VYC-96)', () => {
  afterEach(() => {
    internals.localStream = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  type WithCheck = { checkMicAfterForeground: () => Promise<void>; rebuildMicPipeline: (...a: unknown[]) => Promise<void> };
  const svc = groupCallService as unknown as WithCheck;

  function setup(raw: FakeTrack) {
    internals.localStream = stream([track('audio')]);
    internals.micRebuildInFlight = false;
    vi.spyOn(noiseCancellationService, 'getRawAudioTrack').mockReturnValue(raw as unknown as MediaStreamTrack);
    vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices: vi.fn(async () => []) } });
    return vi.spyOn(svc, 'rebuildMicPipeline').mockResolvedValue(undefined);
  }

  it('rebuilds the capture chain when the raw mic track ended in the background', async () => {
    const raw = track('audio');
    raw.readyState = 'ended';
    const rebuild = setup(raw);
    await svc.checkMicAfterForeground();
    expect(rebuild).toHaveBeenCalledWith('foreground', expect.any(String));
  });

  it('muted raw track: rebuilt only in the mobile viewport', async () => {
    const raw = track('audio');
    raw.muted = true;
    let rebuild = setup(raw);
    (internals as unknown as { micRebuildBlockedUntil: number }).micRebuildBlockedUntil = 0;
    // Десктоп (matchMedia без совпадения) — muted не пересобирается.
    vi.stubGlobal('window', { ...window, matchMedia: () => ({ matches: false }) });
    await svc.checkMicAfterForeground();
    expect(rebuild).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    rebuild = setup(raw);
    vi.stubGlobal('window', { ...window, matchMedia: () => ({ matches: true }) });
    await svc.checkMicAfterForeground();
    expect(rebuild).toHaveBeenCalledWith('foreground', expect.any(String));
  });

  it('does nothing for a live, unmuted raw track (the desktop case)', async () => {
    const rebuild = setup(track('audio'));
    await svc.checkMicAfterForeground();
    expect(rebuild).not.toHaveBeenCalled();
  });
});
