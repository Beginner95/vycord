import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useT, hasKey, type TKey } from '@/i18n';
import { resolveUploadUrl } from '@/services/api';
import type { Sticker } from '@/types';
import { validateStickerFile, ALLOWED_STICKER_TYPES } from '@/utils/stickerUpload';
import type { ServerStickers } from '@/components/useServerStickers';
import './StickerManager.css';

interface StickerManagerBodyProps {
  /** Результат useServerStickers — список и операции над ним. */
  manager: ServerStickers;
  /** Просьба удалить стикер. Подтверждение (ConfirmModal) рисует вызывающая
   *  сторона: в десктопной модалке оно обязано быть сестрой .sticker-manager
   *  внутри оверлея, поэтому в тело оно не переезжает. */
  onRequestDelete: (sticker: Sticker) => void;
}

/** Всё содержимое менеджера стикеров, кроме оболочки: поле имени, дропзона,
 *  блок превью (с инлайновой кнопкой загрузки), тост ошибки, список. Корень —
 *  фрагмент, чтобы DOM десктопной модалки остался прежним: дети лежат прямо
 *  в .sticker-manager. */
export function StickerManagerBody({ manager, onRequestDelete }: StickerManagerBodyProps) {
  const t = useT();
  const { stickers, error, setError, busy, upload } = manager;
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const acceptFile = (f: File | undefined) => {
    if (!f) return;
    const errKey = validateStickerFile(f);
    if (errKey) {
      setFile(null);
      // validateStickerFile возвращает ГОЛЫЙ код ('stickerInvalidFormat',
      // 'sticker_file_too_large'), а строки лежат под errors.* — без префикса
      // translate() не находит ключ и возвращает его же, и пользователь видел
      // в тосте «stickerInvalidFormat». Тот же приём, что в apiErrorText
      // (services/api.ts:48-55): hasKey сначала, потом t.
      const fullKey = `errors.${errKey}`;
      setError(hasKey(fullKey) ? t(fullKey as TKey) : t('errors.unknown'));
      return;
    }
    setError(null);
    setFile(f);
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    acceptFile(e.target.files?.[0]);
    e.target.value = '';
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    acceptFile(e.dataTransfer.files?.[0]);
  };

  const handleUpload = async () => {
    if (!file || !name.trim()) return;
    await upload(name.trim(), file, () => {
      setName('');
      setFile(null);
    });
  };

  return (
    <>
      <input
        type="text"
        className="input"
        placeholder={t('chat.stickerNamePlaceholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_STICKER_TYPES.join(',')}
        onChange={handleInputChange}
        className="sticker-file-input-hidden"
      />
      <div
        className={`sticker-dropzone${dragOver ? ' is-active' : ''}${error ? ' is-error' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <span className="sticker-dropzone-icon">
          <ImagePlus size={28} strokeWidth={1.8} />
        </span>
        <div className="sticker-dropzone-hint">
          {file ? (
            <img className="sticker-dropzone-preview" src={preview ?? undefined} alt={file.name} />
          ) : (
            t('chat.stickerDropHint')
          )}
        </div>
        <div className="sticker-dropzone-restrictions">{t('chat.stickerFormats')}</div>
      </div>

      {file && (
        <div className="sticker-preview-info">
          <span className="sticker-preview-name">{file.name}</span>
          <div className="sticker-preview-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setFile(null)}>
              {t('chat.stickerRemoveFile')}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || !name.trim()} onClick={handleUpload}>
              {t('chat.stickerUpload')}
            </button>
          </div>
        </div>
      )}

      {error && <div className="error-toast">{error}</div>}

      <div className="sticker-manager-list">
        {stickers.map((s) => (
          <div key={s.id} className="sticker-manager-item">
            <img src={resolveUploadUrl(s.image_url)} alt={s.name} width={48} height={48} />
            <span>{s.name}</span>
            <button
              type="button"
              className="panel-icon-btn is-danger"
              title={t('common.delete')}
              aria-label={t('common.delete')}
              onClick={() => onRequestDelete(s)}
            >
              <Trash2 size={15} strokeWidth={1.8} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
