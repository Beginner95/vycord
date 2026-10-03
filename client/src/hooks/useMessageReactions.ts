import { useCallback, useEffect } from 'react';
import { apiService } from '@/services/api';
import { wsService } from '@/services/websocket';
import { useMessageStore } from '@/stores/messageStore';
import { applyReaction, hasReacted } from '@/utils/reactions';
import type { ReactionsSnapshot, Sticker } from '@/types';

/**
 * Реакции ленты канала (VYC-106). Снимок с сервера — из ответа или из WS —
 * всегда заменяет реакции сообщения целиком: потерянное или задвоенное
 * событие не разводит счётчики. Переключение оптимистичное, с откатом.
 */
export function useMessageReactions(
  channelId: string | undefined,
  userId: string | undefined,
  onError: (err: unknown) => void,
) {
  const updateMessage = useMessageStore((s) => s.updateMessage);

  useEffect(() => wsService.on('message_reactions', (payload) => {
    const p = payload as ReactionsSnapshot;
    if (!channelId || p.channel_id !== channelId) return;
    updateMessage(p.message_id, { reactions: p.reactions ?? [] });
  }), [channelId, updateMessage]);

  const toggle = useCallback(async (messageId: string, key: string, sticker?: Sticker) => {
    if (!channelId || !userId) return;
    // Состояние — из стора, а не из замыкания рендера: двойной клик должен
    // видеть результат первого.
    const before = useMessageStore.getState().messages.find((m) => m.id === messageId)?.reactions;
    const current = before?.find((r) => r.key === key);
    const add = !(current && hasReacted(current, userId));
    updateMessage(messageId, { reactions: applyReaction(before, key, userId, add, sticker) });
    try {
      const snap = add
        ? await apiService.addReaction(channelId, messageId, key)
        : await apiService.removeReaction(channelId, messageId, key);
      updateMessage(messageId, { reactions: snap.reactions ?? [] });
    } catch (err) {
      updateMessage(messageId, { reactions: before });
      onError(err);
    }
  }, [channelId, userId, updateMessage, onError]);

  return { toggle };
}
