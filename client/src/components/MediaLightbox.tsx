import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Attachment } from '@/types';
import { resolveUploadUrl } from '@/services/api';
import { downloadUrl } from '@/utils/attachmentUrl';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { useModalFocus } from '@/hooks/useModalFocus';
import { useT } from '@/i18n';
import { VideoPlayer } from './VideoPlayer';
import './MediaLightbox.css';

interface MediaLightboxProps {
  attachments: Attachment[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

/**
 * pickLightboxMedia переводит клик по вложению в состояние лайтбокса.
 *
 * Индекс от ленты сквозной по всем вложениям сообщения, а листать в
 * фуллскрине можно только картинки и видео: в сообщении [png, mp3, pdf]
 * стрелка вправо выдала бы <img src="…аудио…"> — битую картинку. Поэтому
 * список фильтруется, а индекс пересчитывается на отфильтрованный.
 *
 * Возвращает null, если кликнули по не-медиа: открывать нечего.
 */
export function pickLightboxMedia(
  attachments: Attachment[],
  index: number,
): { attachments: Attachment[]; index: number } | null {
  const target = attachments[index];
  if (!target || !isLightboxMedia(target)) return null;

  const media = attachments.filter(isLightboxMedia);
  return { attachments: media, index: media.indexOf(target) };
}

function isLightboxMedia(a: Attachment): boolean {
  return a.kind === 'image' || a.kind === 'video';
}

export function MediaLightbox({ attachments, index, onIndexChange, onClose }: MediaLightboxProps) {
  const t = useT();
  const current = attachments[index];
  const ref = useRef<HTMLDivElement>(null);

  // M5.5 T4 (D8): the lightbox is a blocking overlay and now says so. Adopting
  // useModalFocus buys the modal stack (Escape closes only the top-most
  // overlay), the Tab trap and focus restore; wearing `.modal-overlay` below is
  // what makes isBlockingOverlayOpen() count it, so ⌘K no longer opens the
  // command palette on top of an open lightbox (and Ctrl+Shift+F no longer
  // toggles the search panel under it — ChatArea.tsx's gate reads the same
  // predicate).
  //
  // Escape deliberately does NOT appear in the arrow-key listener below any
  // more: useModalFocus owns it. Keeping both would call onClose twice.
  useModalFocus(!!current, ref, onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && index < attachments.length - 1) onIndexChange(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, attachments.length, onIndexChange]);

  if (!current) return null;

  // Портал в body: иначе overflow и z-index ленты обрежут фуллскрин.
  return createPortal(
    <div ref={ref} className="modal-overlay lightbox-root" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        {current.kind === 'video' ? (
          // В фуллскрине всегда оригинал: миниатюра нужна только ленте.
          <VideoPlayer src={resolveUploadUrl(current.url) ?? ''} autoPlay lightbox />
        ) : (
          <img className="lightbox-media" src={resolveUploadUrl(current.url)} alt={current.file_name} />
        )}

        <div className="lightbox-bar">
          <span className="lightbox-name">{current.file_name}</span>
          <a className="lightbox-download" href={downloadUrl(current.url)} title={t('chat.download')}>
            <Download size={16} strokeWidth={1.8} />
            {t('chat.download')}
          </a>
        </div>
      </div>

      {index > 0 && (
        <button type="button" className="lightbox-nav is-prev"
          onClick={(e) => { e.stopPropagation(); onIndexChange(index - 1); }}
          aria-label={t('chat.previous')}>
          <ChevronLeft size={20} strokeWidth={1.8} />
        </button>
      )}
      {index < attachments.length - 1 && (
        <button type="button" className="lightbox-nav is-next"
          onClick={(e) => { e.stopPropagation(); onIndexChange(index + 1); }}
          aria-label={t('chat.next')}>
          <ChevronRight size={20} strokeWidth={1.8} />
        </button>
      )}

      {/* Without an explicit target useModalFocus focuses the first focusable in
          DOM order, which here is the download link — landing the caret on a
          navigation away from the overlay. The close button is the safe default. */}
      <button type="button" className="lightbox-close" data-autofocus onClick={onClose} aria-label={t('common.close')}>
        <X size={20} strokeWidth={1.8} />
      </button>
    </div>,
    document.body,
  );
}
