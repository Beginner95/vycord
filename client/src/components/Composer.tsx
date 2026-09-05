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
import { ExpressionPicker } from '@/components/ExpressionPicker';
import { LinkDialog } from '@/components/LinkDialog';
import { AttachmentButton } from '@/components/AttachmentButton';
import { AttachmentTray } from '@/components/AttachmentTray';
import { useAttachmentUpload } from '@/hooks/useAttachmentUpload';
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
import type { Attachment, Channel, MemberWithUser, Sticker as ServerSticker } from '@/types';
import type { ExpressionTab } from '@/stores/expressionRecentsStore';
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
   *
   * M5.5 T3: `attachments` carries the already-uploaded blobs this message
   * claims. ChatArea maps them to ids for the POST and also pins the array
   * on the optimistic row, so a `failed` row still knows what it was
   * carrying and its retry can re-send the same ids.
   */
  onSend: (content: string, attachments?: Attachment[]) => void;
  serverStickers: ServerSticker[];
  /** Resolves `true` on success; the picker stays open on failure. */
  onSendSticker: (sticker: ServerSticker) => Promise<boolean>;
  canManageStickers: boolean;
  onOpenStickerManager: () => void;
}

/**
 * The whole compose path: the field, its formatting/mention/expression
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<ExpressionTab>('emoji');
  const [linkOpen, setLinkOpen] = useState(false);
  // Own local boolean, mutually exclusive with `pickerOpen` via `togglePicker`
  // below — the `emojiOpen`/`stickerOpen` pair it once paired with was
  // collapsed into `pickerOpen`/`pickerTab` in Task 5.
  const [attachOpen, setAttachOpen] = useState(false);

  /**
   * The two popover surfaces are MUTUALLY EXCLUSIVE: opening one closes the
   * other. Every toggle below goes through this, never through a bare setter.
   *
   * The set used to be three — emoji, sticker, attach. Emoji and sticker are
   * now one ExpressionPicker with tabs, so it is two.
   *
   * Exclusion has to live here because the toggles opt out of the only
   * mechanism that would otherwise provide it. `useDismissOnOutside` dismisses
   * on a DOCUMENT bubble-phase `mousedown`, and each toggle carries
   * `onMouseDown={(e) => e.stopPropagation()}` so it can close its own picker.
   * React's SyntheticEvent.stopPropagation() calls
   * nativeEvent.stopPropagation() at the root container, so that press never
   * reaches the document — and the document listener is also what would have
   * dismissed the OTHER surface. The opt-out and cross-dismissal cannot both
   * come from that one listener; the opt-out is the one worth keeping (it is
   * what makes a toggle able to close its own picker), so exclusion is
   * explicit state here.
   *
   * `fmtOpen` and `linkOpen` are deliberately OUTSIDE the set. The formatting
   * toolbar is a persistent strip rather than an occluding popover, and it is
   * what renders the second picker toggle — closing it on open would detach
   * that button mid-interaction. `linkOpen` is a dialog with its own scrim.
   */
  const togglePicker = (which: 'picker' | 'attach') => {
    setPickerOpen((v) => (which === 'picker' ? !v : false));
    setAttachOpen((v) => (which === 'attach' ? !v : false));
  };

  /**
   * Emoji and sticker share one surface, so their buttons differ only in which
   * tab they land on. Pressing the button for the tab already showing closes
   * the picker; pressing the other SWITCHES tab rather than closing — the
   * behaviour that motivates merging the two surfaces in the first place.
   */
  const openPickerOn = (tab: ExpressionTab) => {
    if (pickerOpen && pickerTab !== tab) {
      setPickerTab(tab);
      return;
    }
    setPickerTab(tab);
    togglePicker('picker');
  };

  // Shares one zustand store with ChatArea's own call of this hook: the hook
  // holds no local state (a stable-reference selector plus useCallback
  // wrappers over store actions), so two call sites are two views of the same
  // drafts — nothing is prop-drilled between the drop overlay and the tray.
  const uploads = useAttachmentUpload(channel.id);
  const readyAttachments = uploads.drafts
    .map((d) => d.attachment)
    .filter((a): a is Attachment => !!a);

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
    // A message is valid with text OR with at least one finished upload.
    if (!content && readyAttachments.length === 0) return;
    // While anything is still uploading, hold the send — the message must
    // not leave without its file.
    if (uploads.isUploading) return;
    submittingRef.current = true;
    queueMicrotask(() => { submittingRef.current = false; });
    // Snapshot before clearing: clearSent must remove exactly what went out
    // and nothing else, so an error chip stays put instead of vanishing with
    // a successful neighbour.
    const sent = readyAttachments;
    // Clear synchronously, before onSend does anything async — the field is
    // empty well before any real second keypress could land. develop cleared
    // the tray only after the POST resolved; here send is optimistic (Task
    // 11), so the tray follows the field and clears now. The attachments ride
    // along on the optimistic row, so a failed send can still retry them.
    setInput('');
    setCaretInQuoteLine(false);
    uploads.clearSent(sent.map((a) => a.id));
    onSend(content, sent.length ? sent : undefined);
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

  // Pasting a URL over a non-empty selection turns it into a markdown link;
  // pasting a file (usually a screenshot) is an attachment, not text.
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      uploads.addFiles(files);
      return;
    }

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
          onPickerToggle={() => openPickerOn('emoji')}
          pickerOpen={pickerOpen && pickerTab === 'emoji'}
          quote={{ active: caretInQuoteLine, onToggle: toggleQuotePrefix }}
        />
      )}
      {/* Pending uploads sit above the input row, so the chips never push the
          field off its baseline mid-type. Renders nothing when empty. */}
      <AttachmentTray drafts={uploads.drafts} onCancel={uploads.cancel} onRetry={uploads.retry} />
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
          className={`composer-icon-btn${pickerOpen && pickerTab === 'stickers' ? ' is-active' : ''}`}
          aria-label={t('chat.stickers')}
          title={t('chat.stickers')}
          // useDismissOnOutside dismisses on BUBBLE-phase `mousedown`, so any
          // button that opens a dismissible surface must stop propagation here
          // or it closes-then-reopens: mousedown dismisses the picker, and the
          // functional updater in onClick immediately turns it back on — the
          // toggle can never close its own picker. Same opt-out as
          // AttachmentButton's, which inherited it from develop.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => openPickerOn('stickers')}
        >
          <Sticker size={17} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className={`composer-icon-btn${pickerOpen && pickerTab === 'emoji' ? ' is-active' : ''}`}
          aria-label={t('chat.emoji')}
          title={t('chat.emoji')}
          // See the sticker toggle above: bubble-phase `mousedown` opt-out, or
          // the picker can never be closed by its own button.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => openPickerOn('emoji')}
        >
          <Smile size={17} strokeWidth={1.8} />
        </button>
        <AttachmentButton
          open={attachOpen}
          onToggle={() => togglePicker('attach')}
          onClose={() => setAttachOpen(false)}
          onFiles={(files) => uploads.addFiles(files)}
        />
        <button
          type="submit"
          className="composer-send"
          aria-label={t('chat.send')}
          disabled={(!input.trim() && readyAttachments.length === 0) || uploads.isUploading}
        >
          <SendHorizontal size={17} strokeWidth={1.8} />
        </button>
        <MentionDropdown mention={mention} />
      </form>
      <p className="composer-hint">{t('chat.composerHint')}</p>
      {pickerOpen && (
        <ExpressionPicker
          tabs={['emoji', 'stickers', 'gif']}
          initialTab={pickerTab}
          onTabChange={setPickerTab}
          onClose={() => setPickerOpen(false)}
          onSelectEmoji={(emoji) => { insertAtCaret(target, emoji); setPickerOpen(false); }}
          stickers={{
            serverId: channel.server_id,
            items: serverStickers,
            onSend: async (sticker) => {
              const ok = await onSendSticker(sticker);
              if (ok) setPickerOpen(false);
              return ok;
            },
            onManage: canManageStickers
              ? () => { setPickerOpen(false); onOpenStickerManager(); }
              : undefined,
          }}
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
