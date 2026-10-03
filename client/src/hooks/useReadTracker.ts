import { useEffect, type RefObject } from 'react';
import { useMessageStore, type ChatMessage } from '@/stores/messageStore';
import { useUnreadStore } from '@/stores/unreadStore';
import { comparePos, msgPos } from '@/utils/readCursor';

/** «Видно на экране» значит «прочитано» только при окне в фокусе и видимой вкладке. */
export function isAttentive(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

/**
 * VYC-104: двигает курсор прочтения канала до самого позднего сообщения,
 * чья строка в ленте видна, пока окно в фокусе. Видимое без фокуса копится
 * и фиксируется на focus/visibilitychange — если строка всё ещё на экране.
 *
 * Строки ищутся по data-message-id (его ставит MessageRow). Эффект
 * пересоздаётся на каждое изменение ленты: новые строки нужно начать
 * наблюдать, а начальное уведомление IntersectionObserver заново соберёт
 * множество видимых.
 */
export function useReadTracker(
  channelId: string | undefined,
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  const messages = useMessageStore((s) => s.messages);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !channelId || !enabled) return;

    const byId = new Map<string, ChatMessage>();
    for (const m of messages) byId.set(m.id, m);
    const visible = new Set<string>();

    const commit = () => {
      if (!isAttentive()) return;
      let best: ChatMessage | null = null;
      for (const id of visible) {
        const m = byId.get(id);
        // Строка из ленты прошлого канала (переключение ещё не доехало),
        // плашка звонка, неотправленное — курсор на них не ставим.
        if (!m || m.channel_id !== channelId || m.kind === 'call' || m.deliveryState) continue;
        if (!best || comparePos(msgPos(m), msgPos(best)) > 0) best = m;
      }
      if (best) useUnreadStore.getState().markRead(channelId, best);
    };

    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.messageId;
        if (!id) continue;
        // Видна хотя бы половина строки или её нижний край — высокое
        // сообщение не засчитывается по одной верхней кромке.
        const rootBottom = e.rootBounds?.bottom ?? Number.POSITIVE_INFINITY;
        const seen = e.isIntersecting && (e.intersectionRatio >= 0.5 || e.boundingClientRect.bottom <= rootBottom);
        if (seen) visible.add(id);
        else visible.delete(id);
      }
      commit();
    }, { root, threshold: [0, 0.5, 1] });

    root.querySelectorAll<HTMLElement>('[data-message-id]').forEach((el) => observer.observe(el));
    window.addEventListener('focus', commit);
    document.addEventListener('visibilitychange', commit);
    return () => {
      observer.disconnect();
      window.removeEventListener('focus', commit);
      document.removeEventListener('visibilitychange', commit);
    };
  }, [channelId, containerRef, enabled, messages]);
}
