/** Волна голосового: 64 значения 0–255 (контракт сервера, миграция 027). */
export const WAVEFORM_LEN = 64;

const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export function waveformToBase64(values: number[]): string {
  return btoa(String.fromCharCode(...values.map(clampByte)));
}

export function waveformFromBase64(b64: string | undefined): number[] {
  if (!b64) return [];
  try {
    return Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return [];
  }
}

/**
 * Сжимает пики, снятые каждые ~100 мс, до WAVEFORM_LEN столбиков: максимум
 * в бакете, нормализация к 0–255 по максимуму записи. Тишина даёт нули —
 * без деления на ноль.
 */
export function downsampleWaveform(peaks: number[], len = WAVEFORM_LEN): number[] {
  if (peaks.length === 0) return new Array(len).fill(0);
  const buckets = Array.from({ length: len }, (_, i) => {
    const from = Math.floor((i * peaks.length) / len);
    const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / len));
    let max = 0;
    for (let j = from; j < to && j < peaks.length; j++) max = Math.max(max, peaks[j]);
    return max;
  });
  const top = Math.max(...buckets);
  if (top <= 0) return new Array(len).fill(0);
  return buckets.map((v) => clampByte((v / top) * 255));
}

/** Столбик и промежуток волны в пузыре, px — синхронно с VoiceMessage.css. */
const BAR_PX = 2;
const GAP_PX = 2;

/** Сколько столбиков влезает в ширину волны. 0 — ширина ещё не измерена. */
export function barsForWidth(width: number): number {
  if (width <= 0) return WAVEFORM_LEN;
  return Math.max(1, Math.min(WAVEFORM_LEN, Math.floor((width + GAP_PX) / (BAR_PX + GAP_PX))));
}

/** Ужимает волну до n столбиков максимумом в бакете (значения уже 0–255). */
export function resampleWaveform(values: number[], n: number): number[] {
  if (n >= values.length) return values;
  return Array.from({ length: n }, (_, i) => {
    const from = Math.floor((i * values.length) / n);
    const to = Math.max(from + 1, Math.floor(((i + 1) * values.length) / n));
    return Math.max(...values.slice(from, to));
  });
}
