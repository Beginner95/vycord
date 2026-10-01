import { buildMicConstraints } from '@/services/mediaDevices';
import { getDeniedMediaKinds } from '@/services/mediaPermissions';
import { downsampleWaveform } from './waveform';
import { MAX_MS, MIN_MS, type RecorderFailure } from './voiceGesture';

/** 32 кбит/с: 15 минут ≈ 3.6 МБ — далеко от лимита плана. */
const BITRATE = 32_000;
const PEAK_EVERY_MS = 100;
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4'];

export interface VoiceRecording { blob: Blob; mimeType: string; durationMs: number; waveform: number[] }
export interface VoiceRecorderHandle { level(): number; stop(): Promise<VoiceRecording>; discard(): void }

export class VoiceRecorderError extends Error {
  constructor(public reason: RecorderFailure) { super(reason); }
}

export interface RecorderDeps {
  getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>;
  createRecorder(stream: MediaStream, mimeType: string): MediaRecorder;
  isTypeSupported(type: string): boolean;
  createAudioContext(): AudioContext;
  now(): number;
  micDenied(): Promise<boolean>;
}

const browserDeps = (): RecorderDeps => ({
  getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
  createRecorder: (stream, mimeType) =>
    new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: BITRATE }),
  isTypeSupported: (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t),
  createAudioContext: () => new AudioContext(),
  now: () => performance.now(),
  micDenied: async () => {
    const api = (window as Window & typeof globalThis).electronAPI;
    return (await getDeniedMediaKinds(api)).microphoneDenied;
  },
});

export function pickMimeType(isTypeSupported: (t: string) => boolean): string {
  return MIME_CANDIDATES.find((t) => isTypeSupported(t)) ?? '';
}

/** Имя — подсказка; окончательное имя голосового выбирает сервер по контейнеру. */
export function voiceFileName(mimeType: string): string {
  if (mimeType.startsWith('audio/ogg')) return 'voice.ogg';
  if (mimeType.startsWith('audio/mp4')) return 'voice.m4a';
  return 'voice.weba';
}

export function toRecorderFailure(err: unknown): RecorderFailure {
  if (err instanceof VoiceRecorderError) return err.reason;
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'mic_denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'mic_not_found';
  return 'mic_failed';
}

async function openMic(deps: RecorderDeps): Promise<MediaStream> {
  try {
    return await deps.getUserMedia({ audio: buildMicConstraints() });
  } catch (err) {
    // Выбранный микрофон пропал — как acquireUserMedia, падаем к системному.
    if (err instanceof DOMException && err.name === 'OverconstrainedError') {
      return deps.getUserMedia({ audio: true });
    }
    throw err;
  }
}

export async function startVoiceRecorder(over: Partial<RecorderDeps> = {}): Promise<VoiceRecorderHandle> {
  const deps = { ...browserDeps(), ...over };
  if (await deps.micDenied()) throw new VoiceRecorderError('mic_denied');

  let stream: MediaStream;
  try {
    stream = await openMic(deps);
  } catch (err) {
    throw new VoiceRecorderError(toRecorderFailure(err));
  }

  let ctx: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let released = false;
  // Единственная точка освобождения (spec §2.2): трек, контекст, таймер.
  const release = () => {
    if (released) return;
    released = true;
    if (timer) clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => {});
  };

  try {
    const mimeType = pickMimeType(deps.isTypeSupported);
    const recorder = deps.createRecorder(stream, mimeType);
    ctx = deps.createAudioContext();
    // iOS/Safari: контекст, созданный после await getUserMedia, может остаться suspended.
    void ctx.resume?.()?.catch(() => {});
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    const sample = () => {
      analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      let sum = 0;
      for (const v of buf) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
      return { peak, rms: Math.sqrt(sum / buf.length) };
    };
    const peaks: number[] = [];
    timer = setInterval(() => peaks.push(sample().peak), PEAK_EVERY_MS);

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    const startedAt = deps.now();
    recorder.start(1000);

    return {
      level: () => (released ? 0 : Math.min(1, sample().rms * 4)),
      stop: () => new Promise<VoiceRecording>((resolve) => {
        const durationMs = Math.min(MAX_MS, Math.max(MIN_MS, Math.round(deps.now() - startedAt)));
        if (peaks.length === 0) peaks.push(sample().peak);
        const finish = () => {
          release();
          const type = recorder.mimeType || mimeType || 'audio/webm';
          resolve({ blob: new Blob(chunks, { type }), mimeType: type, durationMs, waveform: downsampleWaveform(peaks) });
        };
        if (recorder.state === 'inactive') {
          finish();
        } else {
          recorder.onstop = finish;
          recorder.stop();
        }
      }),
      discard: () => {
        if (recorder.state !== 'inactive') {
          recorder.ondataavailable = null;
          recorder.onstop = null;
          recorder.stop();
        }
        release();
      },
    };
  } catch (err) {
    release();
    throw new VoiceRecorderError(toRecorderFailure(err));
  }
}
