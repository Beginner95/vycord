import { useState } from 'react';
import type { Attachment } from '@/types';
import { apiService, resolveUploadUrl } from '@/services/api';
import { downloadUrl } from '@/utils/attachmentUrl';
import { Download, FileText, Maximize2 } from 'lucide-react';
import { AudioPlayer } from './AudioPlayer';
import { VideoPlayer } from './VideoPlayer';
import { useT } from '@/i18n';
import './MessageAttachments.css';

interface MessageAttachmentsProps {
  attachments: Attachment[];
  onOpen: (index: number) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Картинка с самопочинкой ссылки: подпись живёт неделю, и у долго открытой
 * вкладки она может протухнуть. Тогда onError запрашивает свежие метаданные
 * и перерисовывает — без ручной перезагрузки.
 */
function AttachmentImage({ att, onOpen }: { att: Attachment; onOpen: () => void }) {
  const [src, setSrc] = useState(resolveUploadUrl(att.thumb_url || att.url));
  const [refreshed, setRefreshed] = useState(false);

  const handleError = async () => {
    if (refreshed) return;
    setRefreshed(true);
    try {
      const fresh = await apiService.getAttachment(att.id);
      setSrc(resolveUploadUrl(fresh.thumb_url || fresh.url));
    } catch {
      // Вложение удалено или доступ пропал — оставляем сломанную картинку,
      // подменять её заглушкой смысла нет.
    }
  };

  return (
    <img
      className="attachment-image"
      src={src}
      alt={att.file_name}
      width={att.width}
      height={att.height}
      loading="lazy"
      onClick={onOpen}
      onError={handleError}
    />
  );
}

export function MessageAttachments({ attachments, onOpen }: MessageAttachmentsProps) {
  const t = useT();
  if (attachments.length === 0) return null;

  return (
    <div className={`message-attachments attachment-count-${Math.min(attachments.length, 4)}`}>
      {attachments.map((att, i) => {
        const content = resolveUploadUrl(att.url);

        if (att.kind === 'image') {
          return (
            <div className="attachment-cell" key={att.id}>
              <AttachmentImage att={att} onOpen={() => onOpen(i)} />
              <a className="attachment-download" href={downloadUrl(att.url)} aria-label={t('chat.download')} title={t('chat.download')}>
                <Download size={16} strokeWidth={1.8} />
              </a>
            </div>
          );
        }

        if (att.kind === 'video') {
          return (
            <div className="attachment-cell" key={att.id}>
              <VideoPlayer src={content ?? ''} />
              <button type="button" className="attachment-expand" onClick={() => onOpen(i)} aria-label={t('chat.fullscreen')} title={t('chat.fullscreen')}>
                <Maximize2 size={16} strokeWidth={1.8} />
              </button>
              <a className="attachment-download" href={downloadUrl(att.url)} aria-label={t('chat.download')} title={t('chat.download')}>
                <Download size={16} strokeWidth={1.8} />
              </a>
            </div>
          );
        }

        if (att.kind === 'audio') {
          return (
            <div className="attachment-cell is-wide" key={att.id}>
              <AudioPlayer src={content ?? ''} fileName={att.file_name} />
              <a className="attachment-download" href={downloadUrl(att.url)} aria-label={t('chat.download')} title={t('chat.download')}>
                <Download size={16} strokeWidth={1.8} />
              </a>
            </div>
          );
        }

        return (
          <a className="attachment-file" key={att.id} href={downloadUrl(att.url)}>
            <span className="attachment-file-icon" aria-hidden="true">
              <FileText size={20} strokeWidth={1.8} />
            </span>
            <span className="attachment-file-body">
              <span className="attachment-file-name">{att.file_name}</span>
              <span className="attachment-file-size">{formatSize(att.size_bytes)}</span>
            </span>
          </a>
        );
      })}
    </div>
  );
}
