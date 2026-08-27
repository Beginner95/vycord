import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Attachment } from '@/types';
import { resolveUploadUrl } from '@/services/api';
import { downloadUrl } from '@/utils/attachmentUrl';
import { useT } from '@/i18n';
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowRight' && index < attachments.length - 1) onIndexChange(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, attachments.length, onIndexChange, onClose]);

  if (!current) return null;

  // Портал в body: иначе overflow и z-index ленты обрежут фуллскрин.
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        {current.kind === 'video' ? (
          // В фуллскрине всегда оригинал: миниатюра нужна только ленте.
          <video className="lightbox-media" src={resolveUploadUrl(current.url)} controls autoPlay />
        ) : (
          <img className="lightbox-media" src={resolveUploadUrl(current.url)} alt={current.file_name} />
        )}

        <div className="lightbox-bar">
          <span className="lightbox-name">{current.file_name}</span>
          <a className="lightbox-download" href={downloadUrl(current.url)} title={t('chat.download')}>
            {t('chat.download')}
          </a>
        </div>
      </div>

      {index > 0 && (
        <button type="button" className="lightbox-nav lightbox-nav--prev"
          onClick={(e) => { e.stopPropagation(); onIndexChange(index - 1); }}
          aria-label={t('chat.previous')}>‹</button>
      )}
      {index < attachments.length - 1 && (
        <button type="button" className="lightbox-nav lightbox-nav--next"
          onClick={(e) => { e.stopPropagation(); onIndexChange(index + 1); }}
          aria-label={t('chat.next')}>›</button>
      )}

      <button type="button" className="lightbox-close" onClick={onClose} aria-label={t('common.close')}>×</button>
    </div>,
    document.body,
  );
}
