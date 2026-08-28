import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { ImagePlus, Trash2, X } from 'lucide-react';
import { useT, hasKey, type TKey } from '@/i18n';
import { apiService, apiErrorText, resolveUploadUrl } from '@/services/api';
import type { Sticker } from '@/types';
import { validateStickerFile, ALLOWED_STICKER_TYPES } from '@/utils/stickerUpload';
import { ConfirmModal } from '@/components/ConfirmModal';
import './StickerManager.css';

interface StickerManagerProps {
  serverId: string;
  onClose: () => void;
  onStickersChanged?: () => void;
}

export function StickerManager({ serverId, onClose, onStickersChanged }: StickerManagerProps) {
  const t = useT();
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Храним стикер целиком, а не id: заголовок подтверждения подставляет его имя.
  const [confirmDelete, setConfirmDelete] = useState<Sticker | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiService.listStickers(serverId).then(setStickers).catch((e) => setError(apiErrorText(e, t)));
  }, [serverId, t]);

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
    setBusy(true);
    try {
      const created = await apiService.uploadSticker(serverId, name.trim(), file);
      setStickers((prev) => [...prev, created]);
      setName('');
      setFile(null);
      setError(null);
      onStickersChanged?.();
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (sticker: Sticker) => {
    setConfirmDelete(null);
    try {
      await apiService.deleteSticker(serverId, sticker.id);
      setStickers((prev) => prev.filter((s) => s.id !== sticker.id));
      onStickersChanged?.();
    } catch (err) {
      setError(apiErrorText(err, t));
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sticker-manager" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{t('chat.manageStickersTitle')}</h2>
          <button
            type="button"
            className="modal-close-btn"
            title={t('common.close')}
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

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
                onClick={() => setConfirmDelete(s)}
              >
                <Trash2 size={15} strokeWidth={1.8} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {
        // Сестра .sticker-manager внутри оверлея, а не её потомок — тот же приём,
        // что и у ConfirmModal в Settings.tsx: только так клик по фону
        // подтверждения действительно доходит до onClick={onClose} этого оверлея
        // и e.stopPropagation() в ConfirmModal проверяется по-настоящему.
        // Внутри .sticker-manager его гасил бы её собственный stopPropagation.
        //
        // Строчные //, а не блочный /* */: stripComments в check-i18n.mjs
        // вырезает только // и ОДНОСТРОЧНЫЕ /* */, так что многострочный блок —
        // структурная слепая зона (CONSTRAINTS §5). Это гигиена по ФОРМЕ, а не
        // починка реальной находки: конкретно этот текст эвристика не ловит ни
        // в каком виде — ни одна строка не содержит ни голого >текста<, ни
        // placeholder|title|aria-label|alt="…", ни alert(/confirm(. Проверено
        // эмпирически на ревью M4 T9: прежний /* */-блок вернули в дерево и
        // прогнали check:i18n — те же 4 предупреждения ErrorBoundary, ноль
        // новых. T10 ведёт этот гейт к нулю, поэтому форму чистим заранее.
      }
      <ConfirmModal
        open={confirmDelete !== null}
        title={t('chat.deleteStickerTitle', { name: confirmDelete?.name ?? '' })}
        body={t('chat.deleteStickerBody')}
        confirmLabel={t('common.delete')}
        onConfirm={() => { if (confirmDelete) void handleDelete(confirmDelete); }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
