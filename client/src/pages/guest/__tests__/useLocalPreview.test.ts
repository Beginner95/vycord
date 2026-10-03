// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useLocalPreview } from '../useLocalPreview';

// Превью гостя до входа: выключенные камера / микрофон освобождаются (браузер
// гасит индикатор «используется»), включение захватывает их заново.

interface FakeTrack {
  kind: string;
  readyState: 'live' | 'ended';
  stop: () => void;
}

function track(kind: string): FakeTrack {
  const t: FakeTrack = { kind, readyState: 'live', stop: vi.fn(() => { t.readyState = 'ended'; }) };
  return t;
}

class FakeMediaStream {
  private readonly list: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) { this.list = [...tracks]; }
  getTracks() { return this.list; }
  getAudioTracks() { return this.list.filter((t) => t.kind === 'audio'); }
  getVideoTracks() { return this.list.filter((t) => t.kind === 'video'); }
}

describe('useLocalPreview', () => {
  let gum: ReturnType<typeof vi.fn>;
  let captured: FakeTrack[];

  beforeEach(() => {
    captured = [];
    gum = vi.fn(async (c: MediaStreamConstraints) => {
      const tracks = [
        ...(c.audio ? [track('audio')] : []),
        ...(c.video ? [track('video')] : []),
      ];
      captured.push(...tracks);
      return new FakeMediaStream(tracks);
    });
    vi.stubGlobal('MediaStream', FakeMediaStream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: gum } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const live = (kind: string) => captured.filter((t) => t.kind === kind && t.readyState === 'live');

  it('captures mic and camera in one request', async () => {
    const { result } = renderHook(() => useLocalPreview({ micOn: true, videoOn: true }));
    await waitFor(() => expect(result.current.camera).not.toBeNull());
    expect(gum).toHaveBeenCalledTimes(1);
    expect(gum).toHaveBeenCalledWith({ audio: true, video: true });
    expect(result.current.mic?.getAudioTracks()).toHaveLength(1);
  });

  it('camera off stops the camera but keeps the mic; on captures it again', async () => {
    const { result, rerender } = renderHook(({ on }) => useLocalPreview({ micOn: true, videoOn: on }), { initialProps: { on: true } });
    await waitFor(() => expect(result.current.camera).not.toBeNull());

    rerender({ on: false });
    expect(result.current.camera).toBeNull();
    expect(live('video')).toHaveLength(0);
    expect(live('audio')).toHaveLength(1);

    rerender({ on: true });
    await waitFor(() => expect(result.current.camera).not.toBeNull());
    expect(gum).toHaveBeenLastCalledWith({ video: true });
    expect(live('video')).toHaveLength(1);
  });

  it('camera turned off while the first request is pending is released when it lands', async () => {
    let resolve!: (s: FakeMediaStream) => void;
    gum.mockImplementationOnce((c: MediaStreamConstraints) => new Promise((r) => {
      resolve = (s) => r(s);
      void c;
    }));
    const { result, rerender } = renderHook(({ on }) => useLocalPreview({ micOn: true, videoOn: on }), { initialProps: { on: true } });
    rerender({ on: false });

    const audio = track('audio');
    const video = track('video');
    captured.push(audio, video);
    await act(async () => { resolve(new FakeMediaStream([audio, video])); });

    expect(result.current.camera).toBeNull();
    expect(video.readyState).toBe('ended');
    expect(audio.readyState).toBe('live');
  });

  it('unmount right after the first capture lands still releases its camera', async () => {
    let resolve!: (s: FakeMediaStream) => void;
    gum.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const { unmount } = renderHook(() => useLocalPreview({ micOn: true, videoOn: true }));
    const audio = track('audio');
    const video = track('video');
    // Промис резолвится, но React ещё не закоммитил ready — сразу размонтируем.
    resolve(new FakeMediaStream([audio, video]));
    await Promise.resolve();
    unmount();
    expect(video.readyState).toBe('ended');
    expect(audio.readyState).toBe('ended');
  });

  it('mic off stops the mic but keeps the camera; on captures it again', async () => {
    const { result, rerender } = renderHook(
      ({ mic }) => useLocalPreview({ micOn: mic, videoOn: true }),
      { initialProps: { mic: true } },
    );
    await waitFor(() => expect(result.current.mic).not.toBeNull());

    rerender({ mic: false });
    expect(result.current.mic).toBeNull();
    expect(live('audio')).toHaveLength(0);
    expect(live('video')).toHaveLength(1);

    rerender({ mic: true });
    await waitFor(() => expect(result.current.mic).not.toBeNull());
    expect(gum).toHaveBeenLastCalledWith({ audio: true });
    expect(live('audio')).toHaveLength(1);
  });

  it('first capture asks only for what is on; nothing when both are off', async () => {
    const { result } = renderHook(() => useLocalPreview({ micOn: false, videoOn: true }));
    await waitFor(() => expect(result.current.camera).not.toBeNull());
    expect(gum).toHaveBeenCalledWith({ audio: false, video: true });
    expect(result.current.mic).toBeNull();

    gum.mockClear();
    renderHook(() => useLocalPreview({ micOn: false, videoOn: false }));
    await act(async () => {});
    expect(gum).not.toHaveBeenCalled();
  });

  it('a blocked camera warns without hiding the working mic, and the warning clears', async () => {
    let cameraBlocked = true;
    gum.mockImplementation(async (c: MediaStreamConstraints) => {
      if (c.video && cameraBlocked) throw new DOMException('blocked', 'NotAllowedError');
      const tracks = [
        ...(c.audio ? [track('audio')] : []),
        ...(c.video ? [track('video')] : []),
      ];
      captured.push(...tracks);
      return new FakeMediaStream(tracks);
    });
    const { result, rerender } = renderHook(
      ({ cam }) => useLocalPreview({ micOn: true, videoOn: cam }),
      { initialProps: { cam: true } },
    );
    // Общий запрос отклонён целиком — микрофон захвачен отдельным запросом.
    await waitFor(() => expect(result.current.mic).not.toBeNull());
    await waitFor(() => expect(result.current.denied).toBe(true));
    expect(result.current.camera).toBeNull();

    rerender({ cam: false }); // выключенная камера — не «недоступна»
    await waitFor(() => expect(result.current.denied).toBe(false));

    cameraBlocked = false; // доступ выдали
    rerender({ cam: true });
    await waitFor(() => expect(result.current.camera).not.toBeNull());
    expect(result.current.denied).toBe(false);
  });

  it('unmount releases everything', async () => {
    const { result, unmount } = renderHook(() => useLocalPreview({ micOn: true, videoOn: true }));
    await waitFor(() => expect(result.current.camera).not.toBeNull());
    unmount();
    expect(live('audio')).toHaveLength(0);
    expect(live('video')).toHaveLength(0);
  });
});
