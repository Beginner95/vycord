// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useLocalPreview } from '../useLocalPreview';

// Превью гостя до входа: выключенная камера освобождается (браузер гасит
// индикатор «камера используется»), включение захватывает её заново.

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
    const { result } = renderHook(() => useLocalPreview(true));
    await waitFor(() => expect(result.current.camera).not.toBeNull());
    expect(gum).toHaveBeenCalledTimes(1);
    expect(gum).toHaveBeenCalledWith({ audio: true, video: true });
    expect(result.current.mic?.getAudioTracks()).toHaveLength(1);
  });

  it('camera off stops the camera but keeps the mic; on captures it again', async () => {
    const { result, rerender } = renderHook(({ on }) => useLocalPreview(on), { initialProps: { on: true } });
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
    const { result, rerender } = renderHook(({ on }) => useLocalPreview(on), { initialProps: { on: true } });
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
    const { unmount } = renderHook(() => useLocalPreview(true));
    const audio = track('audio');
    const video = track('video');
    // Промис резолвится, но React ещё не закоммитил ready — сразу размонтируем.
    resolve(new FakeMediaStream([audio, video]));
    await Promise.resolve();
    unmount();
    expect(video.readyState).toBe('ended');
    expect(audio.readyState).toBe('ended');
  });

  it('unmount releases everything', async () => {
    const { result, unmount } = renderHook(() => useLocalPreview(true));
    await waitFor(() => expect(result.current.camera).not.toBeNull());
    unmount();
    expect(live('audio')).toHaveLength(0);
    expect(live('video')).toHaveLength(0);
  });
});
