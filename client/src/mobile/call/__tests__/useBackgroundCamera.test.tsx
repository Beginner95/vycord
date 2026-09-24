// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup, act } from '@testing-library/react';

interface FakeTrack { enabled: boolean; readyState: 'live' | 'ended'; muted: boolean }

const svc = vi.hoisted(() => {
  const makeStream = () => ({ getVideoTracks: () => (state.track ? [state.track] : []) });
  const state = { track: null as unknown as FakeTrack, stream: null as unknown as { getVideoTracks: () => FakeTrack[] } };
  state.stream = makeStream();
  const service = {
    get localStreamState() {
      return state.stream;
    },
    screenStreamState: null,
    isScreenSharing: false,
    currentRoomIdState: null as string | null,
    // Как настоящий toggleMuteVideo: переключает enabled, true = камера выкл.
    toggleMuteVideo: vi.fn(() => {
      state.track.enabled = !state.track.enabled;
      return !state.track.enabled;
    }),
    releaseCameraForBackground: vi.fn(async () => { state.track.readyState = 'ended'; }),
    reacquireCameraAfterBackground: vi.fn(async (): Promise<boolean> => {
      if (state.track.readyState === 'ended') state.track = { enabled: false, readyState: 'live', muted: false };
      return true;
    }),
    toggleMuteAudio: vi.fn(),
    leaveGroupCall: vi.fn(),
  };
  return { state, service, makeStream };
});
vi.mock('@/services/groupCall', () => ({ groupCallService: svc.service }));
vi.mock('@/services/callBus', () => ({ callBus: { send: vi.fn(), on: vi.fn(() => () => {}) } }));

import { useBackgroundCamera, BACKGROUND_CAMERA_DEBOUNCE_MS } from '@/mobile/call/useBackgroundCamera';
import { useCallStore } from '@/stores/callStore';

let visibility: 'visible' | 'hidden' = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

function setVisibility(v: 'visible' | 'hidden') {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Звонок идёт, камера включена пользователем. */
function inCallWithCamera(on = true) {
  svc.state.track = { enabled: on, readyState: 'live', muted: false };
  useCallStore.setState({ status: 'connected', isVideoOff: !on, isScreenSharing: false });
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  visibility = 'visible';
  svc.service.isScreenSharing = false;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useCallStore.getState().reset();
});

async function hideFully() {
  act(() => setVisibility('hidden'));
  await act(async () => { await vi.advanceTimersByTimeAsync(BACKGROUND_CAMERA_DEBOUNCE_MS + 10); });
}

describe('useBackgroundCamera', () => {
  it('hidden with the camera on → turns it off the button way and releases it; visible → back on', async () => {
    inCallWithCamera(true);
    renderHook(() => useBackgroundCamera(true));

    await hideFully();
    expect(svc.service.toggleMuteVideo).toHaveBeenCalledTimes(1);
    expect(useCallStore.getState().isVideoOff).toBe(true);
    expect(svc.service.releaseCameraForBackground).toHaveBeenCalledTimes(1);

    act(() => setVisibility('visible'));
    await flush();
    expect(svc.service.reacquireCameraAfterBackground).toHaveBeenCalledTimes(1);
    expect(svc.service.toggleMuteVideo).toHaveBeenCalledTimes(2);
    expect(useCallStore.getState().isVideoOff).toBe(false);
    // Пересозданный трек включён.
    expect(svc.state.track.readyState).toBe('live');
    expect(svc.state.track.enabled).toBe(true);
  });

  it('camera turned off by the user before minimising → stays off on return', async () => {
    inCallWithCamera(false);
    renderHook(() => useBackgroundCamera(true));

    await hideFully();
    act(() => setVisibility('visible'));
    await flush();

    expect(svc.service.toggleMuteVideo).not.toHaveBeenCalled();
    expect(svc.service.releaseCameraForBackground).not.toHaveBeenCalled();
    expect(svc.service.reacquireCameraAfterBackground).not.toHaveBeenCalled();
    expect(useCallStore.getState().isVideoOff).toBe(true);
  });

  it('screen sharing → does not touch the camera', async () => {
    inCallWithCamera(true);
    useCallStore.setState({ isScreenSharing: true });
    renderHook(() => useBackgroundCamera(true));

    await hideFully();
    act(() => setVisibility('visible'));
    await flush();

    expect(svc.service.toggleMuteVideo).not.toHaveBeenCalled();
    expect(svc.service.releaseCameraForBackground).not.toHaveBeenCalled();
    expect(svc.service.reacquireCameraAfterBackground).not.toHaveBeenCalled();
  });

  it('quick hidden → visible within the debounce does nothing', async () => {
    inCallWithCamera(true);
    renderHook(() => useBackgroundCamera(true));

    act(() => setVisibility('hidden'));
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKGROUND_CAMERA_DEBOUNCE_MS / 2); });
    act(() => setVisibility('visible'));
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKGROUND_CAMERA_DEBOUNCE_MS * 2); });

    expect(svc.service.toggleMuteVideo).not.toHaveBeenCalled();
    expect(svc.service.releaseCameraForBackground).not.toHaveBeenCalled();
    expect(svc.service.reacquireCameraAfterBackground).not.toHaveBeenCalled();
    expect(useCallStore.getState().isVideoOff).toBe(false);
  });

  it('call ended while in the background → nothing is turned back on', async () => {
    inCallWithCamera(true);
    renderHook(() => useBackgroundCamera(true));

    await hideFully();
    act(() => useCallStore.getState().reset()); // звонок закончился
    act(() => setVisibility('visible'));
    await flush();

    expect(svc.service.reacquireCameraAfterBackground).not.toHaveBeenCalled();
    expect(svc.service.toggleMuteVideo).toHaveBeenCalledTimes(1); // только выключение
  });

  it('user changed the camera while hidden → the pending resume is cancelled', async () => {
    inCallWithCamera(true);
    renderHook(() => useBackgroundCamera(true));

    await hideFully();
    // Ручное изменение (например, MediaSession/пилюля) — сбрасывает намерение.
    act(() => useCallStore.setState({ isVideoOff: true, isMuted: true }));
    act(() => useCallStore.setState({ isVideoOff: false }));
    act(() => useCallStore.setState({ isVideoOff: true }));
    act(() => setVisibility('visible'));
    await flush();

    expect(svc.service.reacquireCameraAfterBackground).not.toHaveBeenCalled();
    expect(useCallStore.getState().isVideoOff).toBe(true);
  });

  it('re-enable failure keeps the call up: camera stays off and a toast is shown', async () => {
    inCallWithCamera(true);
    renderHook(() => useBackgroundCamera(true));
    svc.service.reacquireCameraAfterBackground.mockRejectedValueOnce(new DOMException('busy', 'NotReadableError'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await hideFully();
    act(() => setVisibility('visible'));
    await flush();

    expect(useCallStore.getState().status).toBe('connected');
    expect(useCallStore.getState().isVideoOff).toBe(true);
    expect(useCallStore.getState().mediaWarning).toBeTruthy();
    warn.mockRestore();
  });

  it('disabled (no group call) → no listeners act', async () => {
    inCallWithCamera(true);
    renderHook(() => useBackgroundCamera(false));
    await hideFully();
    expect(svc.service.toggleMuteVideo).not.toHaveBeenCalled();
  });

  it('manual camera-on after a failed resume re-captures the dead track', async () => {
    inCallWithCamera(true);
    renderHook(() => useBackgroundCamera(true));
    svc.service.reacquireCameraAfterBackground.mockRejectedValueOnce(new Error('denied'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await hideFully();
    act(() => setVisibility('visible'));
    await flush();
    expect(svc.state.track.readyState).toBe('ended');

    // Пользователь жмёт кнопку «камера» (тот же путь, что handleToggleVideo).
    act(() => { useCallStore.setState({ isVideoOff: svc.service.toggleMuteVideo() }); });
    await flush();

    expect(svc.state.track.readyState).toBe('live');
    expect(svc.state.track.enabled).toBe(true);
    expect(useCallStore.getState().isVideoOff).toBe(false);
    warn.mockRestore();
  });
});

describe('useBackgroundCamera — races (review)', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  it('manual camera-on during getUserMedia: the fresh (disabled) track gets enabled', async () => {
    inCallWithCamera(true);
    renderHook(() => useBackgroundCamera(true));
    await hideFully();

    const gum = deferred<boolean>();
    svc.service.reacquireCameraAfterBackground.mockImplementationOnce(async () => {
      await gum.promise;
      svc.state.track = { enabled: false, readyState: 'live', muted: false };
      return true;
    });
    act(() => setVisibility('visible'));
    await flush();
    // Пользователь жмёт «камера», пока идёт getUserMedia: toggle включает старый мёртвый трек.
    act(() => { useCallStore.setState({ isVideoOff: svc.service.toggleMuteVideo() }); });
    expect(useCallStore.getState().isVideoOff).toBe(false);
    gum.resolve(true);
    await flush();

    expect(svc.state.track.readyState).toBe('live');
    expect(svc.state.track.enabled).toBe(true);
    expect(useCallStore.getState().isVideoOff).toBe(false);
  });

  it('localStream replaced by a mic rebuild during resume → preview switches to the current stream', async () => {
    inCallWithCamera(true);
    const oldStream = svc.state.stream;
    const video = document.createElement('video');
    video.play = vi.fn(() => Promise.resolve());
    (video as unknown as { srcObject: unknown }).srcObject = oldStream;
    document.body.appendChild(video);
    renderHook(() => useBackgroundCamera(true));
    await hideFully();

    const rebuilt = svc.makeStream();
    svc.service.reacquireCameraAfterBackground.mockImplementationOnce(async () => {
      svc.state.stream = rebuilt; // пересборка микрофона заменила localStream
      svc.state.track = { enabled: false, readyState: 'live', muted: false };
      return true;
    });
    act(() => setVisibility('visible'));
    await flush();

    expect((video as unknown as { srcObject: unknown }).srcObject).toBe(rebuilt);
    expect(svc.state.track.enabled).toBe(true);
    video.remove();
    svc.state.stream = oldStream;
  });
});
