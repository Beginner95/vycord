import { useState } from 'react';
import { apiService, resolveUploadUrl } from '@/services/api';
import type { Attachment } from '@/types';

/**
 * Самопочинка протухшей подписи (вынесено из AttachmentImage): подпись живёт
 * неделю, и у долго открытой вкладки она протухает. Первый onError берёт
 * свежие метаданные; второй раз не пробуем. blob:-URL (оптимистичная строка
 * голосового) чинить нечем и незачем.
 */
export function useSelfHealingSrc(
  attachmentId: string,
  initialUrl: string | undefined,
  pick: (a: Attachment) => string | undefined = (a) => a.url,
) {
  const isBlob = !!initialUrl?.startsWith('blob:');
  const [src, setSrc] = useState(isBlob ? initialUrl : resolveUploadUrl(initialUrl));
  const [refreshed, setRefreshed] = useState(false);
  const onError = async () => {
    if (refreshed || isBlob) return;
    setRefreshed(true);
    try {
      const fresh = await apiService.getAttachment(attachmentId);
      setSrc(resolveUploadUrl(pick(fresh)));
    } catch {
      // Вложение удалено или доступ пропал — оставляем как есть.
    }
  };
  return { src, onError };
}
