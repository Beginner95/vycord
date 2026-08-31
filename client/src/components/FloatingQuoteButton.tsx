import { Quote } from 'lucide-react';
import { useT } from '@/i18n';
import './FloatingQuoteButton.css';

interface FloatingQuoteButtonProps {
  x: number;
  y: number;
  onConfirm: () => void;
}

/**
 * The affordance `useFloatingSelectionToolbar` renders over a live text
 * selection. Both selection surfaces use it: the chat message list quotes the
 * selected text into the composer, and the composer quote-prefixes its own
 * selected lines. `onMouseDown` (not `onClick`) so the selection survives —
 * a click would blur the textarea and collapse it first.
 */
export function FloatingQuoteButton({ x, y, onConfirm }: FloatingQuoteButtonProps) {
  const t = useT();
  return (
    <button
      type="button"
      className="quote-float-btn"
      style={{ left: x, top: y }}
      aria-label={t('chat.quote')}
      title={t('chat.quote')}
      onMouseDown={(e) => {
        e.preventDefault();
        onConfirm();
      }}
    >
      <Quote size={16} strokeWidth={1.8} />
    </button>
  );
}
