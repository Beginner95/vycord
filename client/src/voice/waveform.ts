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
