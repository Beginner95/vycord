export type BackgroundMode = 'none' | 'blur' | 'image';
export type VideoBackgroundStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Разрешение кадра для сегментации. Меньше модель — быстрее инференс;
 *  маска апскейлится в canvas камеры через drawImage (GPU, мягкие края). */
export const SEGMENT_WIDTH = 320;
export const SEGMENT_HEIGHT = 180;
export const BLUR_RADIUS = 14;

/** Базовый URL wasm/модели: в проде его подставляет Electron IPC
 *  (get-vision-assets-url-sync, как audioAssetsUrl). */
export const VISION_ASSETS_BASE: string =
  (globalThis as { electronAPI?: { visionAssetsUrl?: string } }).electronAPI?.visionAssetsUrl
  ?? '/vision/';

export interface CoverFitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * cover-fit: вписать изображение imageW×imageH в контейнер frameW×frameH,
 * сохранив пропорции. Возвращает null на некорректных размерах.
 */
export function coverFit(imageW: number, imageH: number, frameW: number, frameH: number): CoverFitRect | null {
  if (imageW <= 0 || imageH <= 0 || frameW <= 0 || frameH <= 0) return null;
  const scale = Math.max(frameW / imageW, frameH / imageH);
  const w = imageW * scale;
  const h = imageH * scale;
  return { x: (frameW - w) / 2, y: (frameH - h) / 2, w, h };
}

/**
 * Заполняет альфа-канал RGBA-буфера вероятностью «человек» из confidence-маски
 * фона: alpha = 1 - backgroundConfidence. RGB вызывающий заполняет один раз
 * (255,255,255): используется только альфа (destination-in). length — число
 * пикселей; лишние пиксели rgba не трогаются.
 */
export function fillPersonAlpha(rgba: Uint8ClampedArray, backgroundConfidence: Float32Array, length: number): void {
  const len = Math.min(Math.floor(rgba.length / 4), backgroundConfidence.length, length);
  for (let i = 0; i < len; i++) {
    rgba[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(255 * (1 - backgroundConfidence[i]))));
  }
}

/**
 * Индекс класса «фон» в метках модели (selfie_multiclass: background первый).
 * Если фон не найден — 0: у моделей сегментации фон идёт нулевым классом.
 */
export function backgroundLabelIndex(labels: string[]): number {
  const idx = labels.findIndex((l) => l.toLowerCase().includes('background'));
  return idx >= 0 ? idx : 0;
}