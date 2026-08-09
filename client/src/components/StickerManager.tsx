import { useEffect, useState, type ChangeEvent } from 'react';
import { useT } from '@/i18n';
import { apiService, apiErrorText } from '@/services/api';
import type { Sticker } from '@/types';

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

  useEffect(() => {
    apiService.listStickers(serverId).then(setStickers).catch((e) => setError(apiErrorText(e, t)));
  }, [serverId]);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !name.trim()) return;
    setBusy(true);
    try {
      const created = await apiService.uploadSticker(serverId, name.trim(), file);
      setStickers((prev) => [...prev, created]);
      setName('');
      setError(null);
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setBusy(false);
      e.target.value = '';
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
          <input type="text" placeholder={t('chat.stickerNamePlaceholder')} value={name}
            onChange={(e) => setName(e.target.value)} />
          <input type="file" accept="image/png,image/jpeg" onChange={handleFile} disabled={busy} />
        </div>
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