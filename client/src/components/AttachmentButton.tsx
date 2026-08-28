import { useRef } from 'react';
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

export function AttachmentButton({ open, onToggle, onClose, onFiles }: AttachmentButtonProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useDismissOnOutside<HTMLDivElement>(onClose);

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
        className={`toolbar-btn${open ? ' active' : ''}`}
        aria-label={t('chat.attach')}
        aria-expanded={open}
        title={t('chat.attach')}
        onClick={onToggle}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
      </button>

      {open && (
        <div className="attach-picker" role="menu" ref={popoverRef}>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="menuitem"
              className="attach-picker-item"
              onClick={() => pick(c.accept)}
            >
              {t(c.labelKey)}
            </button>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
        }}
      />
    </>
  );
}
