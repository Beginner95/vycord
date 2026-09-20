import { useSyncExternalStore } from 'react';

/** Единственная граница мобильной модели (спека §2). В CSS — тот же литерал
 *  `(width < 900px)` / `(width >= 900px)`; их держит breakpoint-contract.test.ts.
 *  `<`, а не `<= 899px`: layout viewport дробный (зум, дробный DPR), и только
 *  пара `< 900` / `>= 900` разбивает его без щели (M6 T8, AppPage.css). */
export const MOBILE_MQ = '(width < 900px)';

export function isMobileViewport(): boolean {
  return window.matchMedia(MOBILE_MQ).matches;
}

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(MOBILE_MQ);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileViewport, () => false);
}
