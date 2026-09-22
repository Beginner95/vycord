import { useBackDismiss } from './useBackDismiss';

/** `useBackDismiss` для оверлеев общих компонентов, которые не могут сами звать
 *  хук роутера (десктопные тесты и вёрстка идут без Router). */
export function BackDismissGate({ open, onClose }: { open: boolean; onClose: () => void }) {
  useBackDismiss(open, onClose);
  return null;
}
