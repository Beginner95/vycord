import { useEffect, useRef } from 'react';
import { isBlockingOverlayOpen } from '@/hooks/useModalFocus';

/**
 * Closes a popover (emoji/sticker picker, attach menu) on a click outside of
 * it or on Escape. Returns the ref to attach to the popover's root element.
 *
 * Three deliberate choices here:
 *
 * - The click listener is `mousedown` on the *bubble* phase, so the button
 *   that opened the popover can opt out with `e.stopPropagation()` in its
 *   own `onMouseDown`. Without that opt-out a click on an open picker's
 *   toggle would dismiss it here and immediately re-open it in the toggle's
 *   `onClick`, leaving the picker stuck open. Every such toggle carries the
 *   opt-out: Composer's sticker and emoji buttons, FormattingToolbar's emoji
 *   button (`preventAndStop`, both render sites) and AttachmentButton's.
 * - The key listener is `keydown` on the *capture* phase and stops
 *   propagation, so Escape closes only the popover instead of also reaching
 *   the textarea underneath. Verified, not assumed: capture-at-document runs
 *   before React's root-container listener, so stopping there is what keeps
 *   Escape from reaching MessageRow's editor `onKeyDown`, which cancels the
 *   edit session. Dropping stopPropagation would make one Escape both dismiss
 *   the picker and throw away the user's edit.
 * - …but that same preemption is too strong when a stack-managed overlay is
 *   open ABOVE the popover (M5.5 T4, D9). A capture-phase swallow beats
 *   `useModalFocus`'s bubble-phase listener and its modal stack, so a modal
 *   raised over an open picker could not be closed with Escape at all
 *   (measured: ⌘K over an open emoji picker opened the palette; one Escape
 *   closed the picker and left the palette up). Hence the bail-out below.
 *
 * Shape chosen for D9: **defer via `isBlockingOverlayOpen()`**, not
 * "register through `useModalFocus`'s stack". The latter is not available —
 * `useModalFocus.ts` exports only `useModalFocus` and `isBlockingOverlayOpen`;
 * its `modalStack` is module-private and there is no API for a non-modal
 * participant. Registering would also mean adopting the whole modal contract
 * (Tab trap, autofocus on open, focus restore on close), and autofocus is
 * precisely what a picker must not do — the toolbar's `preventDefault` exists
 * to keep the caret in the textarea.
 *
 * The deferral is sound only because every call site renders OUTSIDE any
 * `.modal-overlay`: EmojiPicker (Composer + MessageRow's editor), StickerPicker
 * (Composer) and AttachmentButton's AttachPicker (Composer). A future picker
 * rendered INSIDE a modal would silently lose its Escape to the modal above it.
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
      // A modal/overlay above us owns this Escape. Bail BEFORE preventDefault
      // and stopPropagation so the key reaches useModalFocus's bubble-phase
      // listener untouched. The popover stays open under the overlay, which is
      // correct: closing it would be a second, unasked-for dismissal.
      if (isBlockingOverlayOpen()) return;
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
