import type { Message } from '@/types';

export interface VoiceListenedEvent { channel_id: string; message_id: string; attachment_id: string; user_id: string }

/**
 * Правило spec §1.5: «прослушано» для меня — если слушал я сам (синхронизация
 * устройств) или я автор и слушал кто-то другой. Иначе событие не про меня.
 */
export function applyVoiceListened<M extends Message>(messages: M[], ev: Pick<VoiceListenedEvent, 'attachment_id' | 'user_id'>, meId: string): M[] {
  let changed = false;
  const next = messages.map((m) => {
    const atts = m.attachments;
    if (!atts?.some((a) => a.id === ev.attachment_id)) return m;
    const updated = atts.map((a) => {
      if (a.id !== ev.attachment_id || a.listened) return a;
      if (ev.user_id !== meId && a.user_id !== meId) return a;
      changed = true;
      return { ...a, listened: true };
    });
    return changed ? { ...m, attachments: updated } : m;
  });
  return changed ? next : messages;
}

export function isVoiceMessage(m: Pick<Message, 'attachments'>): boolean {
  return !!m.attachments?.some((a) => a.is_voice);
}
