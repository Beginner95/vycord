import { describe, it, expect } from 'vitest';
import { barsForWidth, downsampleWaveform, resampleWaveform, WAVEFORM_LEN } from '@/voice/waveform';

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

describe('barsForWidth', () => {
  it('столбик 2px + промежуток 2px, не больше 64 и не меньше 1', () => {
    expect(barsForWidth(254)).toBe(64);
    expect(barsForWidth(1000)).toBe(64);
    expect(barsForWidth(150)).toBe(38);
    expect(barsForWidth(1)).toBe(1);
  });

  it('ширина неизвестна (0) — все 64', () => {
    expect(barsForWidth(0)).toBe(WAVEFORM_LEN);
  });
});

describe('resampleWaveform', () => {
  it('сжимает по максимуму в бакете, без перенормировки', () => {
    expect(resampleWaveform([10, 200, 30, 40], 2)).toEqual([200, 40]);
  });

  it('n не меньше длины — вход без изменений', () => {
    const v = [1, 2, 3];
    expect(resampleWaveform(v, 3)).toBe(v);
    expect(resampleWaveform(v, 64)).toBe(v);
  });
});
