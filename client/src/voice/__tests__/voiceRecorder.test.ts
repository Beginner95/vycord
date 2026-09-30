import { describe, it, expect, vi } from 'vitest';
import { pickMimeType, voiceFileName, toRecorderFailure, startVoiceRecorder, VoiceRecorderError, type RecorderDeps } from '@/voice/voiceRecorder';

function fakeTrack() { return { stop: vi.fn(), kind: 'audio' }; }

function fakeDeps(over: Partial<RecorderDeps> = {}) {
  const track = fakeTrack();
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const ctxClose = vi.fn(() => Promise.resolve());
  let clock = 0;
  const recorder = {
    state: 'inactive',
    mimeType: 'audio/webm;codecs=opus',
    ondataavailable: null as null | ((e: { data: Blob }) => void),
    onstop: null as null | (() => void),
    start: vi.fn(function (this: { state: string }) { this.state = 'recording'; }),
    stop: vi.fn(function (this: { state: string; ondataavailable: ((e: { data: Blob }) => void) | null; onstop: (() => void) | null }) {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) });
      this.onstop?.();
    }),
  };
  const deps: RecorderDeps = {
    getUserMedia: vi.fn(async () => stream),
    createRecorder: vi.fn(() => recorder as unknown as MediaRecorder),
    isTypeSupported: (t) => t.startsWith('audio/webm'),
    createAudioContext: () => ({
      createMediaStreamSource: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
      createAnalyser: () => ({ fftSize: 0, getFloatTimeDomainData: (a: Float32Array) => a.fill(0.5) }),
      close: ctxClose,
    }) as unknown as AudioContext,
    now: () => clock,
    micDenied: async () => false,
    ...over,
  };
  return { deps, track, ctxClose, recorder, advance: (ms: number) => { clock += ms; } };
}

describe('pickMimeType / voiceFileName', () => {
  it('opus/webm первым, затем ogg, затем mp4, иначе пусто', () => {
    expect(pickMimeType(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickMimeType((t) => t.startsWith('audio/ogg'))).toBe('audio/ogg;codecs=opus');
    expect(pickMimeType((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(pickMimeType(() => false)).toBe('');
  });
  it('имя по mime', () => {
    expect(voiceFileName('audio/webm;codecs=opus')).toBe('voice.weba');
    expect(voiceFileName('audio/ogg;codecs=opus')).toBe('voice.ogg');
    expect(voiceFileName('audio/mp4')).toBe('voice.m4a');
    expect(voiceFileName('')).toBe('voice.weba');
  });
});

describe('toRecorderFailure', () => {
  it('маппит DOMException', () => {
    expect(toRecorderFailure(new DOMException('x', 'NotAllowedError'))).toBe('mic_denied');
    expect(toRecorderFailure(new DOMException('x', 'NotFoundError'))).toBe('mic_not_found');
    expect(toRecorderFailure(new Error('boom'))).toBe('mic_failed');
  });
});

describe('startVoiceRecorder', () => {
  it('stop возвращает запись и освобождает трек и контекст', async () => {
    const f = fakeDeps();
    const h = await startVoiceRecorder(f.deps);
    f.advance(4200);
    const rec = await h.stop();
    expect(rec.durationMs).toBe(4200);
    expect(rec.waveform).toHaveLength(64);
    expect(rec.blob.size).toBeGreaterThan(0);
    expect(f.track.stop).toHaveBeenCalled();
    expect(f.ctxClose).toHaveBeenCalled();
  });

  it('длительность зажимается в [1000, 900000]', async () => {
    const f = fakeDeps();
    const h = await startVoiceRecorder(f.deps);
    f.advance(2_000_000);
    expect((await h.stop()).durationMs).toBe(900_000);
  });

  it('discard освобождает трек и контекст, повтор безопасен', async () => {
    const f = fakeDeps();
    const h = await startVoiceRecorder(f.deps);
    h.discard();
    h.discard();
    expect(f.track.stop).toHaveBeenCalledTimes(1);
    expect(f.ctxClose).toHaveBeenCalledTimes(1);
  });

  it('ошибка MediaRecorder после getUserMedia — трек освобождён, ошибка mic_failed', async () => {
    const f = fakeDeps({ createRecorder: () => { throw new Error('no codec'); } });
    await expect(startVoiceRecorder(f.deps)).rejects.toMatchObject({ reason: 'mic_failed' });
    expect(f.track.stop).toHaveBeenCalled();
  });

  it('OverconstrainedError — повтор с audio: true', async () => {
    const f = fakeDeps();
    const gum = vi.fn()
      .mockRejectedValueOnce(new DOMException('x', 'OverconstrainedError'))
      .mockImplementation(f.deps.getUserMedia);
    const h = await startVoiceRecorder({ ...f.deps, getUserMedia: gum });
    expect(gum).toHaveBeenLastCalledWith({ audio: true });
    h.discard();
  });

  it('mac TCC запрет — mic_denied без getUserMedia', async () => {
    const f = fakeDeps({ micDenied: async () => true });
    await expect(startVoiceRecorder(f.deps)).rejects.toBeInstanceOf(VoiceRecorderError);
    expect(f.deps.getUserMedia).not.toHaveBeenCalled();
  });
});
