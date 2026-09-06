import type { MouseEvent } from 'react';
import { Bold, Italic, Underline, Link2, ListOrdered, List, Quote } from 'lucide-react';
import { useT } from '@/i18n';
import './FormattingToolbar.css';

interface FormattingToolbarProps {
  onWrap: (marker: string) => void;
  onBullet: () => void;
  onNumbered: () => void;
  onLink: () => void;
  quote?: { active: boolean; onToggle: () => void };
}

export function FormattingToolbar({ onWrap, onBullet, onNumbered, onLink, quote }: FormattingToolbarProps) {
  const t = useT();
  // Keep the caret/selection in the textarea — the toolbar must not steal focus,
  // or every transform would operate on a collapsed selection.
  const prevent = (e: MouseEvent) => e.preventDefault();
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
    </div>
  );
}
