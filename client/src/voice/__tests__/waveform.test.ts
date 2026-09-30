import { describe, it, expect } from 'vitest';
import { downsampleWaveform, WAVEFORM_LEN } from '@/voice/waveform';

describe('downsampleWaveform', () => {
  it('всегда ровно 64 значения 0–255', () => {
    const out = downsampleWaveform(Array.from({ length: 1000 }, (_, i) => Math.sin(i) ** 2));
    expect(out).toHaveLength(WAVEFORM_LEN);
    expect(Math.max(...out)).toBe(255);
    expect(out.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)).toBe(true);
  });

  it('берёт максимум в бакете', () => {
    const peaks = new Array(128).fill(0);
    peaks[1] = 1;
    const out = downsampleWaveform(peaks);
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(0);
  });

  it('тишина и пустой вход — нули, без NaN', () => {
    expect(downsampleWaveform(new Array(200).fill(0))).toEqual(new Array(64).fill(0));
    expect(downsampleWaveform([])).toEqual(new Array(64).fill(0));
  });

  it('меньше 64 точек растягивается', () => {
    const out = downsampleWaveform([0, 1]);
    expect(out).toHaveLength(64);
    expect(out[0]).toBe(0);
    expect(out[63]).toBe(255);
  });
});
