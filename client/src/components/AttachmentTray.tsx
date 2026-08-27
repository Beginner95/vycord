import { useEffect, useState } from 'react';
import type { DraftAttachment } from '@/stores/attachmentStore';
import { useT, hasKey, type TKey } from '@/i18n';
import './AttachmentTray.css';

interface AttachmentTrayProps {
  drafts: DraftAttachment[];
  onCancel: (localId: string) => void;
  onRetry: (localId: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Локальное превью картинки, пока файл ещё грузится. */
function LocalPreview({ file }: { file: File }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setSrc(url);
    // Забыть revokeObjectURL — это утечка памяти на каждый выбранный файл.
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!src) return <div className="attach-chip-icon" aria-hidden="true" />;
  return <img className="attach-chip-preview" src={src} alt="" />;
}

export function AttachmentTray({ drafts, onCancel, onRetry }: AttachmentTrayProps) {
  const t = useT();
  if (drafts.length === 0) return null;

  return (
    <div className="attach-tray">
      {drafts.map((d) => {
        const errorKey = `errors.${d.errorCode}`;
        return (
          <div key={d.localId} className={`attach-chip attach-chip--${d.status}`}>
            <LocalPreview file={d.file} />

            <div className="attach-chip-body">
              <span className="attach-chip-name" title={d.file.name}>{d.file.name}</span>
              <span className="attach-chip-meta">
                {d.status === 'error'
                  ? (d.errorCode && hasKey(errorKey) ? t(errorKey as TKey) : t('errors.unknown'))
                  : formatSize(d.file.size)}
              </span>
              {d.status === 'uploading' && (
                <div className="attach-chip-progress" role="progressbar" aria-valuenow={d.progress}>
                  <div className="attach-chip-progress-bar" style={{ width: `${d.progress}%` }} />
                </div>
              )}
            </div>

            {d.status === 'error' && (
              <button type="button" className="attach-chip-btn" onClick={() => onRetry(d.localId)} title={t('chat.retry')}>
                ↻
              </button>
            )}
            <button
              type="button"
              className="attach-chip-btn"
              onClick={() => onCancel(d.localId)}
              aria-label={t('chat.removeAttachment')}
              title={t('chat.removeAttachment')}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
