import { useSyncExternalStore } from 'react';

/** Основной указатель — палец (нет точного курсора). Мобильный Enter в композере
 *  переносит строку, а не отправляет (спека §5.4). */
export const COARSE_MQ = '(pointer: coarse)';

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(COARSE_MQ);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(COARSE_MQ).matches, () => false);
}
