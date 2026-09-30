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
