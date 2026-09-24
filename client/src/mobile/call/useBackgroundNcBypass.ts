import { useEffect } from 'react';
import { noiseCancellationService } from '@/services/noiseCancellation';

/**
 * VYC-96, только мобильная оболочка, пока идёт групповой звонок: свёрнутое
 * приложение → микрофон мимо шумодава (setBackgroundBypass(true)) СРАЗУ, без
 * дебаунса; возврат → шумодав снова в цепочке, если он включён пользователем.
 * Гипотеза: в фоне worker DeepFilterNet голодает по CPU, и worklet отдаёт
 * нули — собеседники перестают слышать через ~5 с после сворачивания.
 *
 * Идемпотентно: сервис игнорирует повтор того же значения, а вызовы
 * сериализуются его opQueue — быстрые hidden→visible применяются по порядку.
 */
export function useBackgroundNcBypass(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    let last: boolean | null = null;
    const apply = (bypass: boolean) => {
      if (last === bypass) return;
      last = bypass;
      void noiseCancellationService.setBackgroundBypass(bypass).catch(() => {});
    };
    const onVisibility = () => apply(document.visibilityState === 'hidden');
    // pagehide: страница уходит (в т.ч. в bfcache) — не оставлять bypass.
    const onPageHide = () => { if (last) apply(false); };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    // Звонок начался уже в фоне.
    if (document.visibilityState === 'hidden') apply(true);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      // Конец звонка: следующий звонок стартует с шумодавом по намерению.
      if (last) apply(false);
    };
  }, [enabled]);
}
