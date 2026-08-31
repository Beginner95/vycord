import type { MouseEvent } from 'react';
import { Bold, Italic, Underline, Link2, ListOrdered, List, Quote, Smile } from 'lucide-react';
import { useT } from '@/i18n';
import './FormattingToolbar.css';

interface FormattingToolbarProps {
  onWrap: (marker: string) => void;
  onBullet: () => void;
  onNumbered: () => void;
  onLink: () => void;
  onEmojiToggle: () => void;
  emojiOpen: boolean;
  quote?: { active: boolean; onToggle: () => void };
}

export function FormattingToolbar({ onWrap, onBullet, onNumbered, onLink, onEmojiToggle, emojiOpen, quote }: FormattingToolbarProps) {
  const t = useT();
  // Keep the caret/selection in the textarea — the toolbar must not steal focus,
  // or every transform would operate on a collapsed selection.
  const prevent = (e: MouseEvent) => e.preventDefault();

  // The emoji button is the only one here that OPENS a dismissible surface, and
  // it needs a second, different guarantee. `useDismissOnOutside` dismisses on
  // BUBBLE-phase document `mousedown`, so without stopPropagation the press
  // closes the open picker and this button's own `onEmojiToggle` immediately
  // re-opens it — the toggle can never close its own picker. `preventDefault`
  // alone does NOT stop propagation, which is why the shared `prevent` above
  // was never enough. Both render sites of this toolbar (Composer and
  // MessageRow's message editor) get the fix from this one declaration.
  //
  // Deliberately NOT folded into `prevent`: that handler is shared by every
  // other .fmt-btn here — seven at the Composer's render site (the optional
  // quote button plus the six unconditional ones), six in MessageRow's editor,
  // where `quote` is absent — and stopPropagation on a document-level
  // `mousedown` starves EVERY document-mousedown dismisser for that click.
  // Measured call sites: ContextMenu.tsx:37, VolumeControlPopover.tsx:60,
  // useFloatingSelectionToolbar.ts:76, plus useDismissOnOutside.ts:65 itself.
  // Widening the opt-out to all of them would break outside-dismissal for those
  // three surfaces to fix one button's problem.
  const preventAndStop = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  return (
    <div className="fmt-toolbar" role="toolbar" aria-label={t('chat.formatting')}>
      {quote && (
        <button type="button" onMouseDown={prevent} className={`fmt-btn${quote.active ? ' is-active' : ''}`} aria-pressed={quote.active} aria-label={t('chat.quote')} title={t('chat.quote')} onClick={quote.onToggle}>
          <Quote size={15} strokeWidth={1.8} />
        </button>
      )}
      <button type="button" onMouseDown={prevent} className="fmt-btn" aria-label={t('chat.bold')} title={t('chat.bold')} onClick={() => onWrap('**')}><Bold size={15} strokeWidth={1.8} /></button>
      <button type="button" onMouseDown={prevent} className="fmt-btn" aria-label={t('chat.italic')} title={t('chat.italic')} onClick={() => onWrap('*')}><Italic size={15} strokeWidth={1.8} /></button>
      <button type="button" onMouseDown={prevent} className="fmt-btn" aria-label={t('chat.underline')} title={t('chat.underline')} onClick={() => onWrap('__')}><Underline size={15} strokeWidth={1.8} /></button>
      <button type="button" onMouseDown={prevent} className="fmt-btn" aria-label={t('chat.link')} title={t('chat.link')} onClick={onLink}><Link2 size={15} strokeWidth={1.8} /></button>
      <button type="button" onMouseDown={prevent} className="fmt-btn" aria-label={t('chat.numberedList')} title={t('chat.numberedList')} onClick={onNumbered}><ListOrdered size={15} strokeWidth={1.8} /></button>
      <button type="button" onMouseDown={prevent} className="fmt-btn" aria-label={t('chat.bulletedList')} title={t('chat.bulletedList')} onClick={onBullet}><List size={15} strokeWidth={1.8} /></button>
      <button type="button" onMouseDown={preventAndStop} className={`fmt-btn${emojiOpen ? ' is-active' : ''}`} aria-label={t('chat.emoji')} title={t('chat.emoji')} onClick={onEmojiToggle}><Smile size={15} strokeWidth={1.8} /></button>
    </div>
  );
}
