import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { apiService, apiErrorText } from '@/services/api';
import type { Sticker } from '@/types';

/** Список стикеров сервера и операции над ним — общее состояние десктопной
 *  модалки (StickerManager) и мобильного экрана (StickersScreen). Форма загрузки
 *  (имя, файл, превью, drag) и подтверждение удаления сюда НЕ входят: первое
 *  живёт в StickerManagerBody, второе — у вызывающей стороны, потому что
 *  ConfirmModal в модалке обязан быть сестрой .sticker-manager внутри оверлея. */
export function useServerStickers(serverId: string, onChanged?: () => void) {
  const t = useT();
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiService.listStickers(serverId).then(setStickers).catch((e) => setError(apiErrorText(e, t)));
  }, [serverId, t]);

  /** onUploaded зовётся синхронно в том же продолжении, что и остальные
   *  setState успеха: форма (имя, файл) сбрасывается в одном батче со списком,
   *  без промежуточного рендера, как и до выноса. */
  const upload = async (name: string, file: File, onUploaded?: () => void) => {
    setBusy(true);
    try {
      const created = await apiService.uploadSticker(serverId, name, file);
      setStickers((prev) => [...prev, created]);
      onUploaded?.();
      setError(null);
      onChanged?.();
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (sticker: Sticker) => {
    try {
      await apiService.deleteSticker(serverId, sticker.id);
      setStickers((prev) => prev.filter((s) => s.id !== sticker.id));
      onChanged?.();
    } catch (err) {
      setError(apiErrorText(err, t));
    }
  };

  return { stickers, error, setError, busy, upload, remove };
}

export type ServerStickers = ReturnType<typeof useServerStickers>;
