import { describe, it, expect } from 'vitest';
import { waveformToBase64, waveformFromBase64 } from '@/voice/waveform';

describe('waveform base64', () => {
  it('кодирует 64 значения 0–255 и декодирует обратно', () => {
    const values = Array.from({ length: 64 }, (_, i) => (i * 4) % 256);
    const b64 = waveformToBase64(values);
    expect(atob(b64)).toHaveLength(64);
    expect(waveformFromBase64(b64)).toEqual(values);
  });

  it('зажимает значения вне 0–255 и дробные', () => {
    expect(waveformFromBase64(waveformToBase64([-5, 300, 12.7]))).toEqual([0, 255, 13]);
  });

  it('пустое/битое → пустой массив, без исключения', () => {
    expect(waveformFromBase64(undefined)).toEqual([]);
    expect(waveformFromBase64('%%%')).toEqual([]);
  });
});
