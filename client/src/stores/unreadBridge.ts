import { audioService } from '@/services/audio';
import { wsService, WS_OPEN_EVENT } from '@/services/websocket';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { useUnreadStore } from '@/stores/unreadStore';
import type { ChannelActivityEvent, ChannelReadEvent } from '@/types';

const LEGACY_KEY = 'vycord.lastRead';

/**
 * VYC-105: звук на чужое сообщение в любом канале любого сервера, открыт он
 * или нет. channel_activity приходит всем участникам сервера, а плашки
 * звонков сервер в него не кладёт. Гость (author_user_id === null) — чужой.
 */
function notifyIncoming(ev: ChannelActivityEvent, selfId: string | undefined) {
  if (ev.op !== 'create') return;
  if (ev.author_user_id !== null && ev.author_user_id === selfId) return;
  audioService.playIncomingMessage();
}

/**
 * VYC-104: счётчики непрочитанного живут всю сессию, а не пока открыт какой-то
 * экран — тот же приём, что initFriendBridge. Полный снимок — при запуске и
 * после каждого (ре)коннекта: дельты WS могли потеряться, курсоры серверные.
 */
export function initUnreadBridge(): () => void {
  // Отметка прочтения раньше жила в localStorage — источник теперь сервер.
  try { window.localStorage.removeItem(LEGACY_KEY); } catch { /* приватный режим */ }

  const store = () => useUnreadStore.getState();
  void store().hydrate();
  const offs = [
    wsService.on(WS_OPEN_EVENT, () => {
      void store().hydrate();
      // channel_read доходит только до смотрящих канал прямо сейчас: прочтения,
      // случившиеся при упавшем сокете, галочки открытого канала не получили.
      const open = useServerStore.getState().currentChannel;
      if (open) void store().loadReceipts(open.id);
    }),
    wsService.on('channel_activity', (p) => {
      const ev = p as ChannelActivityEvent;
      const selfId = useAuthStore.getState().user?.id;
      store().applyActivity(ev, selfId);
      notifyIncoming(ev, selfId);
    }),
    wsService.on('channel_read', (p) => store().applyChannelRead(p as ChannelReadEvent)),
    wsService.on('channel_delete', (p) => store().forgetChannel((p as { id: string }).id)),
    wsService.on('server_delete', (p) => store().forgetServer((p as { id: string }).id)),
  ];
  return () => {
    offs.forEach((off) => off());
    store().reset();
  };
}
