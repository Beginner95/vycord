// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

vi.mock('@/utils/logger', () => ({ logger: { report: vi.fn(), error: vi.fn() } }));

import { logger } from '@/utils/logger';
import {
  FORCE_MOBILE_KEY,
  forceMobileViewport,
  shouldForceMobile,
  targetViewportWidth,
} from '@/mobile/forceMobileViewport';

const base = { maxTouchPoints: 5, screenWidth: 412, screenHeight: 915, innerWidth: 980 };

describe('shouldForceMobile', () => {
  const cases: Array<[string, Parameters<typeof shouldForceMobile>[0], boolean]> = [
    ['телефон в режиме ПК-сайта', base, true],
    ['портрет в режиме ПК (412x915, 980)', base, true],
    ['ландшафт в режиме ПК (915, innerWidth 1280)', { ...base, screenWidth: 915, screenHeight: 412, innerWidth: 1280 }, true],
    ['ландшафт без ПК-режима (915x412, 915)', { ...base, screenWidth: 915, screenHeight: 412, innerWidth: 915 }, false],
    ['ландшафт без ПК-режима (932x430, 932)', { ...base, screenWidth: 932, screenHeight: 430, innerWidth: 932 }, false],
    ['то же в standalone PWA', { ...base, standalone: true }, true],
    ['обычный телефон (innerWidth 412)', { ...base, innerWidth: 412 }, false],
    ['планшет 1024x768 с касанием', { ...base, screenWidth: 1024, screenHeight: 768, innerWidth: 1024 }, false],
    ['планшет 1024x768 в нормальном режиме', { ...base, screenWidth: 1024, screenHeight: 768, innerWidth: 1024 }, false],
    ['iPad портрет 810x1080 в ПК-режиме', { ...base, screenWidth: 810, screenHeight: 1080 }, false],
    ['большой планшет 1280x900', { ...base, screenWidth: 1280, screenHeight: 900 }, false],
    ['ноутбук без касания', { ...base, maxTouchPoints: 0, screenWidth: 1920, screenHeight: 1080, innerWidth: 1920 }, false],
    ['узкий экран без касания', { ...base, maxTouchPoints: 0 }, false],
    ['kill switch', { ...base, disabled: true }, false],
    ['экран не определён (0)', { ...base, screenWidth: 0, screenHeight: 0 }, false],
  ];
  it.each(cases)('%s', (_name, input, expected) => {
    expect(shouldForceMobile(input)).toBe(expected);
  });
});

describe('targetViewportWidth', () => {
  it('портрет: текущая ширина', () => expect(targetViewportWidth(412, 915)).toBe(412));
  it('ландшафт, широкий экран: меньшая сторона', () => expect(targetViewportWidth(915, 412)).toBe(412));
  it('ландшафт, узкий экран: текущая ширина', () => expect(targetViewportWidth(800, 360)).toBe(800));
});

function def(obj: object, key: string, value: unknown) {
  Object.defineProperty(obj, key, { value, configurable: true, writable: true });
}

function setDevice(o: { touch: number; sw: number; sh: number; iw: number }) {
  def(navigator, 'maxTouchPoints', o.touch);
  def(window.screen, 'width', o.sw);
  def(window.screen, 'height', o.sh);
  def(window, 'innerWidth', o.iw);
}

const VIEWPORT = 'width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content';

function metaViewports() {
  return document.querySelectorAll('meta[name="viewport"]');
}

describe('forceMobileViewport', () => {
  let cleanup: () => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(logger.report).mockClear();
    document.head.innerHTML = `<meta name="viewport" content="${VIEWPORT}">`;
    delete document.documentElement.dataset.forceMobile;
    localStorage.clear();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    cleanup = () => {};
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('переписывает meta ровно один раз и ставит applied, когда браузер сузил viewport', () => {
    setDevice({ touch: 5, sw: 412, sh: 915, iw: 980 });
    const spy = vi.spyOn(HTMLMetaElement.prototype, 'setAttribute');
    cleanup = forceMobileViewport();

    expect(metaViewports()).toHaveLength(1);
    expect(metaViewports()[0].getAttribute('content'))
      .toBe('width=412, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content');
    // Браузер отреагировал на meta.
    def(window, 'innerWidth', 412);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(300);

    expect(document.documentElement.dataset.forceMobile).toBe('applied');
    expect(spy.mock.calls.filter(([n]) => n === 'content')).toHaveLength(1);
    expect(logger.report).not.toHaveBeenCalled();
  });

  it('создаёт meta, если её нет', () => {
    document.head.innerHTML = '';
    setDevice({ touch: 5, sw: 412, sh: 915, iw: 980 });
    cleanup = forceMobileViewport();
    expect(metaViewports()).toHaveLength(1);
    expect(metaViewports()[0].getAttribute('content')).toContain('width=412');
  });

  it('innerWidth остался >= 900: failed, без бесконечных повторов', () => {
    setDevice({ touch: 5, sw: 412, sh: 915, iw: 980 });
    const spy = vi.spyOn(HTMLMetaElement.prototype, 'setAttribute');
    cleanup = forceMobileViewport();

    // Браузер игнорирует meta; resize/orientationchange сыплются — meta не трогаем.
    for (let i = 0; i < 20; i++) window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('orientationchange'));
    vi.advanceTimersByTime(60_000);

    expect(document.documentElement.dataset.forceMobile).toBe('failed');
    expect(spy.mock.calls.filter(([n]) => n === 'content')).toHaveLength(1);
    expect(logger.report).toHaveBeenCalledTimes(1);
  });

  it('поворот телефона с узким экраном: meta перезаписывается только при смене ширины', () => {
    setDevice({ touch: 5, sw: 360, sh: 800, iw: 980 });
    const spy = vi.spyOn(HTMLMetaElement.prototype, 'setAttribute');
    cleanup = forceMobileViewport();
    def(window, 'innerWidth', 360);
    vi.advanceTimersByTime(300);

    setDevice({ touch: 5, sw: 800, sh: 360, iw: 800 });
    window.dispatchEvent(new Event('orientationchange'));
    window.dispatchEvent(new Event('resize'));
    expect(metaViewports()[0].getAttribute('content')).toContain('width=800,');
    expect(spy.mock.calls.filter(([n]) => n === 'content')).toHaveLength(2);
  });

  it('kill switch: ничего не трогает', () => {
    localStorage.setItem(FORCE_MOBILE_KEY, '0');
    setDevice({ touch: 5, sw: 412, sh: 915, iw: 980 });
    cleanup = forceMobileViewport();
    expect(metaViewports()[0].getAttribute('content')).toBe(VIEWPORT);
    expect(document.documentElement.dataset.forceMobile).toBe('disabled');
  });

  it('нормальный ландшафт телефона: meta не трогается, logger.report не шлётся', () => {
    setDevice({ touch: 5, sw: 915, sh: 412, iw: 915 });
    cleanup = forceMobileViewport();
    window.dispatchEvent(new Event('orientationchange'));
    vi.advanceTimersByTime(60_000);
    expect(metaViewports()[0].getAttribute('content')).toBe(VIEWPORT);
    expect(document.documentElement.dataset.forceMobile).toBeUndefined();
    expect(logger.report).not.toHaveBeenCalled();
  });

  it.each([
    ['ноутбук без касания', { touch: 0, sw: 1920, sh: 1080, iw: 1920 }],
    ['планшет 1024x768', { touch: 5, sw: 1024, sh: 768, iw: 1024 }],
    ['обычный телефон', { touch: 5, sw: 412, sh: 915, iw: 412 }],
  ])('%s: не трогает meta и dataset', (_n, dev) => {
    setDevice(dev);
    const timersBefore = vi.getTimerCount();
    cleanup = forceMobileViewport();
    expect(metaViewports()[0].getAttribute('content')).toBe(VIEWPORT);
    expect(document.documentElement.dataset.forceMobile).toBeUndefined();
    expect(vi.getTimerCount()).toBe(timersBefore);
  });
});
