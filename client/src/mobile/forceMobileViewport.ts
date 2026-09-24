import { logger } from '@/utils/logger';

/**
 * Принудительная мобильная раскладка на телефоне в режиме «Версия для ПК».
 *
 * В этом режиме мобильный браузер игнорирует `width=device-width` из
 * <meta name="viewport">, layout viewport становится ~980+ CSS px, и единственная
 * граница мобильной модели `(width < 900px)` (breakpoint.ts) не срабатывает.
 * Установленная с такого сайта PWA наследует эту раскладку. Здесь мы явно
 * прописываем в meta физическую ширину устройства (`width=412`), вместо
 * `device-width`, — Chrome для Android при таком значении сжимает layout
 * viewport, даже когда «десктопный сайт» включён.
 *
 * Поведение НА ДЕСКТОПЕ не меняется: без касания (`maxTouchPoints === 0`) и на
 * планшетах/ноутбуках с тачскрином (`min(screen.width, screen.height) >= 600`)
 * модуль ничего не делает.
 *
 * Про ширину экрана. `screen.width/height` — размеры устройства в CSS px, они
 * НЕ зависят от layout viewport и от режима «ПК-сайт» (в отличие от
 * `innerWidth`), поэтому именно они сообщают, что устройство физически узкое.
 * Берём `Math.min(screen.width, screen.height)` — сторону, не зависящую от
 * ориентации (телефон в ландшафте 915×412 остаётся телефоном); `availWidth/availHeight` не используем: они уже вычитают системные
 * панели и в разных браузерах ведут себя непоследовательно. Если браузер в
 * десктопном режиме вернёт и здесь «большой» экран (>= 600), условие не
 * сработает и модуль промолчит — безопасный отказ, а не ложное срабатывание.
 *
 * Отключить для диагностики: localStorage['vycord_force_mobile'] = '0'.
 * Итог пишется в document.documentElement.dataset.forceMobile:
 * 'applied' | 'failed' | 'disabled'.
 */

export const FORCE_MOBILE_KEY = 'vycord_force_mobile';
const MOBILE_MAX = 900;
/** Меньшая сторона экрана, ниже которой устройство считается телефоном.
 *  600 — общепринятая граница «планшет» (sw600dp). Не 900: планшеты 744–834 px
 *  по меньшей стороне (iPad mini/Air, 1024×768) в обычном режиме законно имеют
 *  innerWidth >= 900 в ландшафте, и трогать их нельзя. Телефонам (≤ ~480) до
 *  границы далеко. */
const PHONE_MAX_SIDE = 600;
/** Во включённом «ПК-режиме» layout viewport ШИРЕ экрана устройства
 *  (innerWidth ≈ 980+ при screen.width ≈ 412). В нормальном режиме, в том числе
 *  в ландшафте (915×412, innerWidth 915/932), innerWidth ≈ screen.width. Запас
 *  8% отсекает дробные значения и полосы прокрутки. */
const DESKTOP_MODE_RATIO = 1.08;
const VIEWPORT_TAIL = 'initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content';
/** Жёсткий потолок перезаписей meta за жизнь страницы (защита от петель). */
const MAX_WRITES = 3;
/** Задержки проверок «браузер действительно сузил viewport». */
const VERIFY_DELAYS_MS = [300, 600, 1200];

export interface ForceMobileInput {
  maxTouchPoints: number;
  screenWidth: number;
  screenHeight: number;
  innerWidth: number;
  /** Установленная PWA. На решение не влияет (вкладка на телефоне тоже должна
   *  быть мобильной), но принимается для симметрии с логами/будущих правил. */
  standalone?: boolean;
  /** Kill switch: localStorage['vycord_force_mobile'] === '0'. */
  disabled?: boolean;
}

/** «Мобильное устройство, которому браузер навязал десктопный viewport». */
export function shouldForceMobile(i: ForceMobileInput): boolean {
  if (i.disabled) return false;
  if (!(i.maxTouchPoints > 0)) return false;
  const physical = Math.min(i.screenWidth, i.screenHeight);
  if (!(physical > 0) || physical >= PHONE_MAX_SIDE) return false;
  // Нормальный ландшафт телефона (innerWidth ≈ screen.width) — не ПК-режим.
  if (!(i.innerWidth > i.screenWidth * DESKTOP_MODE_RATIO)) return false;
  return i.innerWidth >= MOBILE_MAX;
}

/** Ширина для meta: текущая ширина экрана, если она мобильная (< 900, телефон
 *  в ландшафте с узким экраном), иначе меньшая сторона (портретная ширина). */
export function targetViewportWidth(screenWidth: number, screenHeight: number): number {
  const min = Math.min(screenWidth, screenHeight);
  return screenWidth > 0 && screenWidth < MOBILE_MAX ? screenWidth : min;
}

function isKilled(): boolean {
  try {
    return window.localStorage.getItem(FORCE_MOBILE_KEY) === '0';
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  try {
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
    return typeof window.matchMedia === 'function'
      && window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

function readInput(disabled: boolean): ForceMobileInput {
  return {
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    innerWidth: window.innerWidth,
    standalone: isStandalone(),
    disabled,
  };
}

function writeViewportMeta(width: number): void {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'viewport';
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', `width=${width}, ${VIEWPORT_TAIL}`);
}

/** Вызывать один раз до монтирования React. Возвращает функцию очистки
 *  (слушатели и таймеры) — нужна тестам, приложению не нужна. */
export function forceMobileViewport(): () => void {
  const root = document.documentElement;
  try {
    if (isKilled()) {
      root.dataset.forceMobile = 'disabled';
      console.info('[viewport] force-mobile выключен через localStorage vycord_force_mobile=0');
      return () => {};
    }

    let writes = 0;
    let lastWidth: number | null = null;
    let timers: ReturnType<typeof setTimeout>[] = [];

    const clearTimers = () => {
      timers.forEach(clearTimeout);
      timers = [];
    };

    const verify = (attempt: number) => {
      if (window.innerWidth < MOBILE_MAX) {
        root.dataset.forceMobile = 'applied';
        console.info(`[viewport] мобильная раскладка включена: innerWidth=${window.innerWidth}`);
        return;
      }
      if (attempt + 1 < VERIFY_DELAYS_MS.length) {
        timers.push(setTimeout(() => verify(attempt + 1), VERIFY_DELAYS_MS[attempt + 1]));
        return;
      }
      root.dataset.forceMobile = 'failed';
      const details = {
        innerWidth: window.innerWidth,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        maxTouchPoints: navigator.maxTouchPoints,
        standalone: isStandalone(),
        viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null,
        uaMobile: (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile ?? null,
      };
      // Фиксированный текст: детали — в extra (см. logger.report).
      logger.report(
        '[viewport] браузер проигнорировал <meta viewport>: остаётся десктопная раскладка',
        { module: 'viewport' },
        details,
      );
    };

    const apply = (width: number) => {
      if (width === lastWidth || writes >= MAX_WRITES) return;
      lastWidth = width;
      writes += 1;
      writeViewportMeta(width);
      clearTimers();
      timers.push(setTimeout(() => verify(0), VERIFY_DELAYS_MS[0]));
    };

    const sync = () => {
      try {
        const input = readInput(false);
        const target = targetViewportWidth(input.screenWidth, input.screenHeight);
        if (lastWidth !== null) {
          // Уже применено: реагируем только на смену целевой ширины (поворот
          // телефона с узким экраном), не на каждый resize.
          if (Math.min(input.screenWidth, input.screenHeight) < PHONE_MAX_SIDE) apply(target);
          return;
        }
        if (shouldForceMobile(input)) apply(target);
      } catch (err) {
        console.warn('[viewport] sync failed', err);
      }
    };

    sync();
    window.addEventListener('orientationchange', sync);
    window.addEventListener('resize', sync);
    return () => {
      clearTimers();
      window.removeEventListener('orientationchange', sync);
      window.removeEventListener('resize', sync);
    };
  } catch (err) {
    console.warn('[viewport] force-mobile init failed', err);
    return () => {};
  }
}
