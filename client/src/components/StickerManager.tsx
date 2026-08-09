import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useT, type TKey } from '@/i18n';
import { apiService, apiErrorText } from '@/services/api';
import type { Sticker } from '@/types';
import { validateStickerFile, ALLOWED_STICKER_TYPES } from '@/utils/stickerUpload';

interface StickerManagerProps {
  serverId: string;
  onClose: () => void;
}

export function StickerManager({ serverId, onClose }: StickerManagerProps) {
  const t = useT();
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
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
      setError(t(errKey as TKey));
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
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('chat.deleteStickerConfirm'))) return;
    try {
      await apiService.deleteSticker(serverId, id);
      setStickers((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(apiErrorText(err, t));
    }
  };

  return (
    <div className="sticker-manager-overlay" onClick={onClose}>
      <div className="sticker-manager" onClick={(e) => e.stopPropagation()}>
        <h3>{t('chat.manageStickersTitle')}</h3>

        <div className="sticker-manager-upload">
          <input
            type="text"
            placeholder={t('chat.stickerNamePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_STICKER_TYPES.join(',')}
          onChange={handleInputChange}
          className="sticker-file-input-hidden"
        />
        <div
          className={`sticker-dropzone${dragOver ? ' active' : ''}${error ? ' error' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <div className="sticker-dropzone-icon">🖼️</div>
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
              <button type="button" onClick={() => setFile(null)}>{t('chat.stickerRemoveFile')}</button>
              <button type="button" className="sticker-upload-submit" disabled={busy || !name.trim()} onClick={handleUpload}>
                {t('chat.stickerUpload')}
              </button>
            </div>
          </div>
        )}

        {error && <div className="error-toast">{error}</div>}

        <div className="sticker-manager-list">
          {stickers.map((s) => (
            <div key={s.id} className="sticker-manager-item">
              <img src={s.image_url} alt={s.name} width={48} height={48} />
              <span>{s.name}</span>
              <button type="button" onClick={() => handleDelete(s.id)}>{t('common.delete')}</button>
            </div>
          ))}
        </div>

        <button type="button" onClick={onClose}>{t('common.close')}</button>
      </div>
    </div>
  );
}