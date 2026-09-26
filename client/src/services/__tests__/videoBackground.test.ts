import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  backgroundLabelIndex,
  coverFit,
  fillPersonAlpha,
  loadBackgroundImage,
} from '@/services/videoBackground';

describe('coverFit', () => {
  it('вписывает изображение в контейнер по большей оси', () => {
    // 1000×500 в 640×480: масштаб по высоте 480/500=0.96 → ширина 960
    const r = coverFit(1000, 500, 640, 480);
    expect(r).toEqual({ x: (640 - 960) / 2, y: 0, w: 960, h: 480 });
  });

  it('не трогает ровно подходящее изображение', () => {
    expect(coverFit(640, 480, 640, 480)).toEqual({ x: 0, y: 0, w: 640, h: 480 });
  });

  it('возвращает null на нулевых размерах', () => {
    expect(coverFit(0, 500, 640, 480)).toBeNull();
    expect(coverFit(1000, 0, 640, 480)).toBeNull();
    expect(coverFit(1000, 500, 0, 480)).toBeNull();
  });
});

describe('fillPersonAlpha', () => {
  it('конвертирует confidence фона в альфу человека', () => {
    const rgba = new Uint8ClampedArray(4 * 3);
    rgba[0] = 255; rgba[1] = 255; rgba[2] = 255; // RGB выставляются один раз
    rgba[4] = 255; rgba[5] = 255; rgba[6] = 255;
    rgba[8] = 255; rgba[9] = 255; rgba[10] = 255;
    fillPersonAlpha(rgba, new Float32Array([0.0, 1.0, 0.25]), 3);
    expect([rgba[3], rgba[7], rgba[11]]).toEqual([255, 0, 191]); // 0.75*255=191.25→191
  });

  it('обрывается по длине массива mask', () => {
    const rgba = new Uint8ClampedArray(4 * 4);
    rgba[15] = 99; // «мусор» за пределами mask — не должен трогаться
    fillPersonAlpha(rgba, new Float32Array([1.0]), 4);
    expect(rgba[15]).toBe(99);
  });
});

describe('backgroundLabelIndex', () => {
  it('находит индекс класса background', () => {
    expect(backgroundLabelIndex(['background', 'hair', 'skin', 'clothes'])).toBe(0);
    expect(backgroundLabelIndex(['hair', 'skin', 'clothes', 'background'])).toBe(3);
    expect(backgroundLabelIndex(['foo', 'bar'])).toBe(0); // fallback на 0
    expect(backgroundLabelIndex([])).toBe(0);
  });
});

describe('loadBackgroundImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * VYC-100: фон грузится с api-домена в canvas-композит движка. Без
   * crossOrigin='anonymous' браузер тянет картинку некорректно-кросс-доменно,
   * канвас таится, и captureStream() отдаёт ЧЁРНЫЕ кадры вместо картинки.
   */
  it('грузит картинку в CORS-режиме (crossOrigin=anonymous)', async () => {
    const created: Array<{ crossOrigin: string | null; src: string }> = [];
    class FakeImage {
      crossOrigin: string | null = null;
      decoding = 'async';
      complete = false;
      naturalWidth = 1920;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        this.complete = true;
        created.push({ crossOrigin: this.crossOrigin, src: value });
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal('Image', FakeImage);

    const img = await loadBackgroundImage('https://cdn.example.com/bg.jpg');

    expect(created).toHaveLength(1);
    expect(created[0].crossOrigin).toBe('anonymous');
    expect(created[0].src).toBe('https://cdn.example.com/bg.jpg');
    expect(img.naturalWidth).toBe(1920);
  });

  it('резолвится и при ошибке загрузки — движок сам откатится на резкий кадр', async () => {
    class FakeImage {
      crossOrigin: string | null = null;
      decoding = 'async';
      complete = true;
      naturalWidth = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        setTimeout(() => this.onerror?.(), 0);
      }
    }
    vi.stubGlobal('Image', FakeImage);

    const img = await loadBackgroundImage('https://cdn.example.com/404.jpg');

    expect(img.naturalWidth).toBe(0);
  });
});