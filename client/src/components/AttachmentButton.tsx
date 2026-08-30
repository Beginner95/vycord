import { useRef } from 'react';
import { Paperclip } from 'lucide-react';
import { useDismissOnOutside } from '@/hooks/useDismissOnOutside';
import { useT } from '@/i18n';

/**
 * Категории задают только фильтр системного диалога. Настоящий тип файла
 * определяет сервер по содержимому: выбор пользователя здесь ни на что не
 * влияет, кроме удобства.
 */
const CATEGORIES = [
  { id: 'image', accept: 'image/*', labelKey: 'chat.attachImage' },
  { id: 'video', accept: 'video/*', labelKey: 'chat.attachVideo' },
  { id: 'audio', accept: 'audio/*', labelKey: 'chat.attachAudio' },
  { id: 'file', accept: '', labelKey: 'chat.attachFile' },
] as const;

interface AttachmentButtonProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onFiles: (files: FileList) => void;
}

/**
 * The popover, split into its own component so `useDismissOnOutside` is
 * subscribed ONLY while the menu is open.
 *
 * M5.5 T3, verified empirically. That hook registers a CAPTURE-phase document
 * keydown listener which, on Escape, calls `preventDefault()` and
 * `stopPropagation()` (useDismissOnOutside.ts:27-31,34). Every other consumer
 * of the hook (EmojiPicker, StickerPicker, ContextMenu, …) is itself mounted
 * only while open, so its swallow lasts exactly as long as the surface that
 * wants Escape. AttachmentButton called the hook from the always-mounted
 * *button*, which was harmless only while the component was unreachable: the
 * moment T3 mounted it in the Composer, a capture-phase Escape swallower went
 * live for the whole lifetime of the channel and every bubble-phase document
 * Escape listener in the app stopped receiving the key — MediaLightbox,
 * useModalFocus (ConfirmModal / Settings / FindServerModal / CommandPalette),
 * MessageSearch, MessageRow's editor-cancel, the mention dropdown.
 *
 * Measured on the merged tree with the button mounted: a synthetic Escape was
 * seen 1x at document-capture and 0x at document-bubble, while a letter key
 * was seen 1x at both. Moving the subscription here restores bubble delivery
 * without touching the shared hook, whose other call sites depend on its
 * current shape.
 */
function AttachPicker({ onClose, onPick }: { onClose: () => void; onPick: (accept: string) => void }) {
  const t = useT();
  const popoverRef = useDismissOnOutside<HTMLDivElement>(onClose);

  return (
    <div className="attach-picker" role="menu" ref={popoverRef}>
      {CATEGORIES.map((c) => (
        <button
          key={c.id}
          type="button"
          role="menuitem"
          className="attach-picker-item"
          onClick={() => onPick(c.accept)}
        >
          {t(c.labelKey)}
        </button>
      ))}
    </div>
  );
}

export function AttachmentButton({ open, onToggle, onClose, onFiles }: AttachmentButtonProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (accept: string) => {
    const input = inputRef.current;
    if (!input) return;
    input.accept = accept;
    input.value = '';
    input.click();
    onClose();
  };

  return (
    <>
      <button
        type="button"
        // stopPropagation обязателен: иначе mousedown закроет попап в
        // useDismissOnOutside, а следующий onClick тут же откроет его снова.
        onMouseDown={(e) => e.stopPropagation()}
        // M5.5 T3 (R-P2): `toolbar-btn` → `composer-attach-btn` and nothing
        // else. Deliberately NOT also `composer-icon-btn` — borrowing the
        // redesign's icon styling here would silently close D10's open state
        // ("AttachmentButton renders bare between T3 and T5") and destroy
        // Task 5's only failure signal. The bare look is correct until T5.
        // The ` active` modifier is likewise left alone: Task 5 Step 4 owns
        // `active` → `is-active`, and splitting one className expression
        // across two tasks is how a rename lands half-applied.
        className={`composer-attach-btn${open ? ' active' : ''}`}
        aria-label={t('chat.attach')}
        aria-expanded={open}
        title={t('chat.attach')}
        onClick={onToggle}
      >
        <Paperclip size={17} strokeWidth={1.8} />
      </button>

      {open && <AttachPicker onClose={onClose} onPick={pick} />}

      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        // Named so the CDP probe can drive selection: smoke.mjs has no
        // setFileInputFiles, so the probe assigns `input.files` directly.
        className="composer-attach-input"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
        }}
      />
    </>
  );
}
