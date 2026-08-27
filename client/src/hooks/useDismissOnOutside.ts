import { useEffect, useRef } from 'react';

/**
 * Closes a popover (emoji/sticker picker) on a click outside of it or on
 * Escape. Returns the ref to attach to the popover's root element.
 *
 * Two deliberate choices here:
 *
 * - The click listener is `mousedown` on the *bubble* phase, so the button
 *   that opened the popover can opt out with `e.stopPropagation()` in its
 *   own `onMouseDown`. Without that opt-out a click on an open picker's
 *   toggle would dismiss it here and immediately re-open it in the toggle's
 *   `onClick`, leaving the picker stuck open.
 * - The key listener is `keydown` on the *capture* phase and stops
 *   propagation, so Escape closes only the popover instead of also reaching
 *   the textarea underneath (which would cancel message editing).
 */
export function useDismissOnOutside<T extends HTMLElement>(onDismiss: () => void) {
  const ref = useRef<T | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismissRef.current();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onDismissRef.current();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);

  return ref;
}
