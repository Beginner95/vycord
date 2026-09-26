import {
  FilesetResolver,
  ImageSegmenter,
  type ImageSegmenterResult,
} from '@mediapipe/tasks-vision';

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

interface VideoBackgroundEngineOptions {
  assetsBase?: string;
}

/**
 * Пайплайн эффекта фона: кадр камеры → даунскейл → сегментация (MediaPipe,
 * GPU) → маска → композит (blur-фон или картинка cover-fit) → канвас-трек.
 *
 * Режим 'none' = полный простой: rAF-луп не запускается, канвас не создан
 * заново, GPU не трогается. Владельцами input-треков движок никогда не
 * является: ни один входной трек не стопается.
 */
export class VideoBackgroundEngine {
  onStatusChange: ((status: VideoBackgroundStatus) => void) | null = null;

  private readonly assetsBase: string;
  private readonly bgCache = new Map<string, HTMLImageElement>();
  private segmenter: ImageSegmenter | null = null;
  private labelIndex = 0;
  private inputVideo: HTMLVideoElement | null = null;
  private inputStream: MediaStream | null = null;
  private segCanvas: HTMLCanvasElement | null = null;
  private maskCanvas: HTMLCanvasElement | null = null;
  private maskImageData: ImageData | null = null;
  private compositeCanvas: HTMLCanvasElement | null = null;
  private compositeCtx: CanvasRenderingContext2D | null = null;
  private personCanvas: HTMLCanvasElement | null = null;
  private personCtx: CanvasRenderingContext2D | null = null;
  private captureTrack: CanvasCaptureMediaStreamTrack | null = null;
  private mode: BackgroundMode = 'none';
  private backgroundUrl: string | null = null;
  private rafId = 0;
  private disposed = false;
  private currentStatus: VideoBackgroundStatus = 'idle';

  constructor(options: VideoBackgroundEngineOptions = {}) {
    this.assetsBase = options.assetsBase ?? VISION_ASSETS_BASE;
  }

  get status(): VideoBackgroundStatus {
    return this.currentStatus;
  }

  get hasEffect(): boolean {
    return (
      !this.disposed
      && this.mode !== 'none'
      && this.segmenter !== null
      && this.inputVideo !== null
      && this.inputStream !== null
      && this.compositeCanvas !== null
      && this.captureTrack !== null
      && this.captureTrack.readyState === 'live'
    );
  }

  /** Канвас-трек для подмены в звонке; null, пока конвейер не построен. */
  get outputTrack(): MediaStreamTrack | null {
    return this.hasEffect ? this.captureTrack : null;
  }

  private setStatus(status: VideoBackgroundStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.onStatusChange?.(status);
  }

  /** Идемпотентно грузит wasm + модель (GPU, при ошибке — CPU). */
  private async loadModel(): Promise<void> {
    if (this.segmenter) return;
    this.setStatus('loading');
    try {
      const fileset = await FilesetResolver.forVisionTasks(this.assetsBase);
      this.segmenter = await this.createSegmenter(fileset, 'GPU').catch(() =>
        this.createSegmenter(fileset, 'CPU'),
      );
      this.labelIndex = backgroundLabelIndex(this.segmenter.getLabels());
      this.setStatus('ready');
    } catch {
      this.segmenter?.close();
      this.segmenter = null;
      this.setStatus('error');
    }
  }

  private createSegmenter(fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, delegate: 'GPU' | 'CPU') {
    return ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: `${this.assetsBase}selfie_multiclass_256x256.tflite`,
        delegate,
      },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
  }

  /**
   * Меняет входной поток. Сохраняет режим: если эффект активен — строит
   * конвейер заново.
   */
  async setInput(stream: MediaStream | null): Promise<void> {
    if (this.inputStream === stream) return;
    this.inputStream = stream;
    this.stopLoop();
    this.teardownPipeline();

    if (!stream) return;
    const camera = stream.getVideoTracks()[0];
    if (!camera) return;

    const video = this.inputVideo ?? document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    // На беззвучный локальный элемент не действует автовоспроизведение-политика;
    // play() зовём руками, чтобы ошибка не молчала.
    video.srcObject = new MediaStream([camera]);
    this.inputVideo = video;
    await video.play().catch(() => {});
    this.canvasSizeFromVideo();

    if (this.mode !== 'none') {
      await this.loadModel();
      const bg = this.backgroundUrl;
      if (bg) void this.ensureBackground(bg);
      this.startLoop();
    }
  }

  async setMode(mode: BackgroundMode, backgroundUrl: string | null): Promise<void> {
    if (this.mode === mode && this.backgroundUrl === backgroundUrl) return;
    this.mode = mode;
    this.backgroundUrl = mode === 'image' ? backgroundUrl : null;

    if (mode === 'none' || !this.inputStream) {
      this.stopLoop();
      return;
    }
    if (!this.segmenter) {
      await this.loadModel();
      if (!this.segmenter) return; // status 'error'
    }
    if (this.backgroundUrl) void this.ensureBackground(this.backgroundUrl);
    this.canvasSizeFromVideo();
    this.startLoop();
  }

  /** Размер канваса из актуального видео-кадра; повторяется при metadata. */
  private canvasSizeFromVideo(): void {
    const video = this.inputVideo;
    if (!video) return;
    const w = Math.max(1, video.videoWidth);
    const h = Math.max(1, video.videoHeight);
    if (!this.compositeCanvas || this.compositeCanvas.width !== w || this.compositeCanvas.height !== h) {
      this.teardownPipeline();
      this.buildPipeline(w, h);
    }
  }

  private buildPipeline(width: number, height: number): void {
    const seg = document.createElement('canvas');
    seg.width = SEGMENT_WIDTH;
    seg.height = SEGMENT_HEIGHT;

    const mask = document.createElement('canvas');
    mask.width = SEGMENT_WIDTH;
    mask.height = SEGMENT_HEIGHT;

    const imageData = mask.getContext('2d')!.createImageData(SEGMENT_WIDTH, SEGMENT_HEIGHT);
    for (let i = 0; i < imageData.data.length; i += 4) {
      imageData.data[i] = 255;
      imageData.data[i + 1] = 255;
      imageData.data[i + 2] = 255;
    }

    const composite = document.createElement('canvas');
    composite.width = width;
    composite.height = height;

    const person = document.createElement('canvas');
    person.width = width;
    person.height = height;

    this.segCanvas = seg;
    this.maskCanvas = mask;
    this.maskImageData = imageData;
    this.compositeCanvas = composite;
    this.compositeCtx = composite.getContext('2d');
    this.personCanvas = person;
    this.personCtx = person.getContext('2d');

    const stream = composite.captureStream(0);
    this.captureTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  }

  private teardownPipeline(): void {
    this.captureTrack?.stop();
    this.captureTrack = null;
    this.segCanvas = null;
    this.maskCanvas = null;
    this.maskImageData = null;
    this.compositeCanvas = null;
    this.compositeCtx = null;
    this.personCanvas = null;
    this.personCtx = null;
  }

  private startLoop(): void {
    if (this.rafId !== 0) return;
    this.rafId = requestAnimationFrame(this.frame);
  }

  private stopLoop(): void {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private frame = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.frame);
    const video = this.inputVideo;
    if (!video || video.readyState < 2) return;
    if (this.mode === 'none' || !this.segmenter || !this.segCanvas || !this.captureTrack) return;

    if (video.videoWidth > 0 && this.compositeCanvas?.width !== video.videoWidth) {
      this.canvasSizeFromVideo();
    }

    const seg = this.segCanvas.getContext('2d');
    if (!seg) return;
    try {
      seg.drawImage(video, 0, 0, SEGMENT_WIDTH, SEGMENT_HEIGHT);
    } catch {
      return;
    }
    try {
      // Callback-вариант: маски живут только внутри колбэка — никаких копий,
      // что и требуется high-throughput режиму (см. .d.ts сегментера).
      this.segmenter.segmentForVideo(this.segCanvas, performance.now(), (result) => {
        this.compositeFrame(result);
        result.close();
      });
    } catch {
      // Единичный сбой кадра не валит луп.
    }
  };

  private compositeFrame(result: ImageSegmenterResult): void {
    const mask = result.confidenceMasks?.[this.labelIndex];
    const video = this.inputVideo;
    const ctx = this.compositeCtx;
    const person = this.personCtx;
    const maskData = this.maskImageData;
    const maskCanvas = this.maskCanvas;
    const composite = this.compositeCanvas;
    const track = this.captureTrack;
    const personCanvas = this.personCanvas;
    if (!mask || !video || !ctx || !person || !maskData || !maskCanvas || !composite || !track || !personCanvas) return;
    if (track.readyState !== 'live') return;

    // 1. Маска фона → альфа человека (SEGMENT sizes, CPU-цикл по 57 КБ).
    const bg = mask.getAsFloat32Array();
    fillPersonAlpha(maskData.data, bg, SEGMENT_WIDTH * SEGMENT_HEIGHT);
    maskCanvas.getContext('2d')!.putImageData(maskData, 0, 0);

    // 2. Силуэт человека: резкий кадр, обрезанный маской (destination-in).
    const frameW = composite.width;
    const frameH = composite.height;
    person.clearRect(0, 0, frameW, frameH);
    person.drawImage(video, 0, 0, frameW, frameH);
    person.globalCompositeOperation = 'destination-in';
    person.drawImage(maskCanvas, 0, 0, frameW, frameH);
    person.globalCompositeOperation = 'source-over';

    // 3. Фон: blur-кадр или картинка cover-fit; без готового фона — резкий кадр.
    ctx.clearRect(0, 0, frameW, frameH);
    if (this.mode === 'blur') {
      ctx.filter = `blur(${BLUR_RADIUS}px)`;
      try {
        ctx.drawImage(video, 0, 0, frameW, frameH);
      } finally {
        ctx.filter = 'none';
      }
    } else if (this.mode === 'image') {
      const img = this.backgroundUrl ? this.bgCache.get(this.backgroundUrl) : undefined;
      const ready = img !== undefined && img.complete && img.naturalWidth > 0;
      if (ready) {
        const fit = coverFit(img.naturalWidth, img.naturalHeight, frameW, frameH);
        if (fit) ctx.drawImage(img, fit.x, fit.y, fit.w, fit.h);
      } else {
        ctx.drawImage(video, 0, 0, frameW, frameH);
      }
    }

    // 4. Человек поверх фона.
    ctx.drawImage(personCanvas, 0, 0);

    // 5. Отдаём кадр pull-режиму captureStream(0).
    track.requestFrame();
  }

  private async ensureBackground(url: string): Promise<void> {
    if (this.bgCache.has(url)) return;
    const img = new Image();
    img.decoding = 'async';
    const loaded = await new Promise<HTMLImageElement>((resolve) => {
      img.onload = () => resolve(img);
      img.onerror = () => resolve(img); // naturalWidth=0 → фолбэк на резкий кадр
      img.src = url;
    });
    if (!this.disposed) this.bgCache.set(url, loaded);
  }

  dispose(): void {
    this.disposed = true;
    this.stopLoop();
    this.teardownPipeline();
    this.bgCache.clear();
    this.segmenter?.close();
    this.segmenter = null;
    if (this.inputVideo) {
      this.inputVideo.srcObject = null;
      this.inputVideo = null;
    }
    this.inputStream = null;
    this.setStatus('idle');
  }
}