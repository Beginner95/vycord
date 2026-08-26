import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { SendHorizontal, Smile, Sticker } from 'lucide-react';
import { FormattingToolbar } from '@/components/FormattingToolbar';
import { FloatingQuoteButton } from '@/components/FloatingQuoteButton';
import { MentionDropdown } from '@/components/MentionDropdown';
import { EmojiPicker } from '@/components/EmojiPicker';
import { StickerPicker } from '@/components/StickerPicker';
import { LinkDialog } from '@/components/LinkDialog';
import { useMentionAutocomplete } from '@/hooks/useMentionAutocomplete';
import { useFloatingSelectionToolbar } from '@/hooks/useFloatingSelectionToolbar';
import {
  toggleQuote,
  toggleBullet,
  toggleNumbered,
  applyLineToggle,
  applyWrap,
  insertAtCaret,
  linkToken,
} from '@/utils/textTransforms';
import { isUnsafeUrl } from '@/utils/markdown';
import { useT } from '@/i18n';
import type { Channel, MemberWithUser, Sticker as ServerSticker } from '@/types';
import './Composer.css';

const QUOTE_PREFIX = '> ';

function lineRangeForSelection(value: string, start: number, end: number) {
  const lineStart = start <= 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
  // A selection that ends exactly at the start of a new line (e.g. Shift+Down
  // stopping at column 0 of the next line) has selected 0 characters of that
  // line — don't treat it as touched.
  const selEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const searchFrom = Math.max(selEnd, lineStart);
  const endIdx = value.indexOf('\n', searchFrom);
  const lineEnd = endIdx === -1 ? value.length : endIdx;
  return { lineStart, lineEnd };
}

export interface ComposerHandle {
  /** Prefill the field with `text` as a `> ` quote block, caret below it. */
  insertQuote(text: string): void;
  /** Focus the field (Task 9's empty-state CTA). */
  focus(): void;
}

interface ComposerProps {
  channel: Channel;
  members: MemberWithUser[];
  canMentionEveryone: boolean;
  /**
   * Sends `content`. Task 11: sending is optimistic — the row is rendered by
   * ChatArea immediately, so the field clears synchronously here too. Any
   * failure surfaces later as the message row's own `danger` chip, not a
   * value this callback returns.
   */
  onSend: (content: string) => void;
  serverStickers: ServerSticker[];
  /** Resolves `true` on success; the picker stays open on failure. */
  onSendSticker: (sticker: ServerSticker) => Promise<boolean>;
  canManageStickers: boolean;
  onOpenStickerManager: () => void;
}

/**
 * The whole compose path: the field, its formatting/mention/emoji/sticker
 * chrome and every text transform that acts on the draft. ChatArea only
 * supplies the send callbacks and the sticker inventory.
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { channel, members, canMentionEveryone, onSend, serverStickers, onSendSticker, canManageStickers, onOpenStickerManager },
  ref,
) {
  const t = useT();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Guards a same-task double-Enter (verified empirically: two keydowns
  // dispatched back to back, with no task boundary between them, both still
  // read the pre-clear `input` closure — React's state update from the first
  // hasn't committed yet, so `if (!content) return` alone doesn't catch it).
  // Reset on a microtask, which always resolves before the next real macro-
  // task (the earliest a second, distinct keypress could ever land), so a
  // legitimate quick second send is never blocked.
  const submittingRef = useRef(false);
  const [input, setInput] = useState('');
  const [caretInQuoteLine, setCaretInQuoteLine] = useState(false);
  const [fmtOpen, setFmtOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const mention = useMentionAutocomplete({
    value: input,
    setValue: setInput,
    inputRef,
    members,
    canMentionEveryone,
  });

  const target = { ref: inputRef, value: input, setValue: setInput };

  // Fresh channel → fresh caret state; the draft itself deliberately survives.
  useEffect(() => {
    inputRef.current?.focus();
    mention.reset();
    setCaretInQuoteLine(false);
  }, [channel.id]);

  // Grow the field with its content (capped at 40vh by the stylesheet).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  const updateQuoteButtonActive = (value: string = input, caret?: number) => {
    const el = inputRef.current;
    const pos = caret ?? el?.selectionStart ?? 0;
    const { lineStart, lineEnd } = lineRangeForSelection(value, pos, pos);
    setCaretInQuoteLine(value.slice(lineStart, lineEnd).startsWith(QUOTE_PREFIX));
  };

  const insertQuote = (text: string) => {
    const el = inputRef.current;
    if (!el) return;
    const quotedBlock = text
      .split('\n')
      .map((line) => (line.startsWith(QUOTE_PREFIX) ? line : `${QUOTE_PREFIX}${line}`))
      .join('\n');
    const newValue = input.length === 0 ? quotedBlock : `${quotedBlock}\n${input}`;
    const caret = input.length === 0 ? quotedBlock.length : quotedBlock.length + 1;
    setInput(newValue);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
      updateQuoteButtonActive(newValue, caret);
    });
  };

  useImperativeHandle(ref, () => ({
    insertQuote,
    focus: () => inputRef.current?.focus(),
  }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    const content = input.trim();
    if (!content) return;
    submittingRef.current = true;
    queueMicrotask(() => { submittingRef.current = false; });
    // Clear synchronously, before onSend does anything async — the field is
    // empty well before any real second keypress could land.
    setInput('');
    setCaretInQuoteLine(false);
    onSend(content);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.handleKeyDown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    mention.handleChange(e);
    updateQuoteButtonActive(e.target.value, e.target.selectionStart ?? undefined);
  };

  // Pasting a URL over a non-empty selection turns it into a markdown link.
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const sel = el.value.slice(start, end);
    if (start !== end && sel.trim() && text.trim() && !isUnsafeUrl(text.trim())) {
      e.preventDefault();
      const token = `[${sel.trim()}](${text.trim()})`;
      const next = el.value.slice(0, start) + token + el.value.slice(end);
      setInput(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
      setCaretInQuoteLine(false);
    }
  };

  const toggleQuotePrefixRange = (start: number, end: number) => {
    const el = inputRef.current;
    const r = toggleQuote(input, start, end);
    setInput(r.value);
    setCaretInQuoteLine(!r.allPrefixed);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(r.start, r.end);
    });
  };

  const toggleQuotePrefix = () => {
    const el = inputRef.current;
    toggleQuotePrefixRange(el?.selectionStart ?? input.length, el?.selectionEnd ?? input.length);
  };

  const selectionToolbar = useFloatingSelectionToolbar({
    containerRef: inputRef,
    resubscribeKey: channel.id,
    getSelectionInfo: (e) => {
      const el = inputRef.current;
      const start = el?.selectionStart;
      const end = el?.selectionEnd;
      if (!el || start == null || end == null || start === end) return null;
      const text = el.value.slice(start, end);
      if (e) return { text, x: e.clientX, y: e.clientY + 16 };
      const rect = el.getBoundingClientRect();
      return { text, x: rect.left + 24, y: rect.top - 8 };
    },
    onConfirm: () => {
      const el = inputRef.current;
      const start = el?.selectionStart;
      const end = el?.selectionEnd;
      if (!el || start == null || end == null) return;
      toggleQuotePrefixRange(start, end);
    },
  });

  return (
    <div className="composer-root">
      {fmtOpen && (
        <FormattingToolbar
          onWrap={(marker) => applyWrap(target, marker)}
          onBullet={() => applyLineToggle(target, toggleBullet)}
          onNumbered={() => applyLineToggle(target, toggleNumbered)}
          onLink={() => setLinkOpen(true)}
          onEmojiToggle={() => setEmojiOpen((v) => !v)}
          emojiOpen={emojiOpen}
          quote={{ active: caretInQuoteLine, onToggle: toggleQuotePrefix }}
        />
      )}
      <form className="composer-field" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className="composer-input"
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onSelect={() => updateQuoteButtonActive()}
          onClick={() => updateQuoteButtonActive()}
          onKeyUp={() => updateQuoteButtonActive()}
          placeholder={t('chat.messagePlaceholder', { channel: channel.name })}
          maxLength={2000}
          rows={1}
        />
        <button
          type="button"
          className={`composer-aa${fmtOpen ? ' is-active' : ''}`}
          aria-pressed={fmtOpen}
          aria-label={t('chat.formatting')}
          title={t('chat.formatting')}
          onClick={() => setFmtOpen((v) => !v)}
        >
          Aa
        </button>
        <button
          type="button"
          className={`composer-icon-btn${stickerOpen ? ' is-active' : ''}`}
          aria-label={t('chat.stickers')}
          title={t('chat.stickers')}
          onClick={() => setStickerOpen((v) => !v)}
        >
          <Sticker size={17} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className={`composer-icon-btn${emojiOpen ? ' is-active' : ''}`}
          aria-label={t('chat.emoji')}
          title={t('chat.emoji')}
          onClick={() => setEmojiOpen((v) => !v)}
        >
          <Smile size={17} strokeWidth={1.8} />
        </button>
        <button type="submit" className="composer-send" aria-label={t('chat.send')} disabled={!input.trim()}>
          <SendHorizontal size={17} strokeWidth={1.8} />
        </button>
        <MentionDropdown mention={mention} />
      </form>
      <p className="composer-hint">{t('chat.composerHint')}</p>
      {emojiOpen && (
        <EmojiPicker
          onSelect={(emoji) => { insertAtCaret(target, emoji); setEmojiOpen(false); }}
          onClose={() => setEmojiOpen(false)}
        />
      )}
      {stickerOpen && (
        <StickerPicker
          stickers={serverStickers}
          onSelect={(sticker) => { void onSendSticker(sticker).then((ok) => { if (ok) setStickerOpen(false); }); }}
          onClose={() => setStickerOpen(false)}
          onManage={canManageStickers ? () => { setStickerOpen(false); onOpenStickerManager(); } : undefined}
        />
      )}
      <LinkDialog
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        onInsert={(label, url) => { insertAtCaret(target, linkToken(label, url)); setLinkOpen(false); }}
      />
      {selectionToolbar.visible && (
        <FloatingQuoteButton x={selectionToolbar.x} y={selectionToolbar.y} onConfirm={selectionToolbar.confirm} />
      )}
    </div>
  );
});
