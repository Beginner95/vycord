import { create } from 'zustand';
import { apiService } from '@/services/api';
import { logger } from '@/utils/logger';
import { comparePos, isAfter, msgPos, type CursorPos } from '@/utils/readCursor';
import type { ChannelActivityEvent, ChannelReadEvent, Message } from '@/types';

/** Сервер считает непрочитанные до 100 (domain.UnreadCountCap). */
export const UNREAD_CAP = 100;
/** Окно троттлинга PUT /read на канал: ведущий край сразу, хвост — в конце окна. */
export const MARK_READ_WINDOW_MS = 1000;
const REHYDRATE_MIN_GAP_MS = 2000;

export interface ChannelUnreadState {
  serverId: string;
  count: number;
  /** Мой курсор прочтения: только вперёд. */
  cursor: CursorPos;
}

interface UnreadState {
  channels: Record<string, ChannelUnreadState>;
  /** Самый дальний курсор ДРУГИХ участников — для галочек моих сообщений. */
  othersRead: Record<string, CursorPos>;
  hydrate(): Promise<void>;
  applyActivity(ev: ChannelActivityEvent, selfId: string | undefined): void;
  applyChannelRead(ev: ChannelReadEvent): void;
  loadReceipts(channelId: string): Promise<void>;
  markRead(channelId: string, msg: { id: string; created_at: string }): void;
  forgetChannel(channelId: string): void;
  forgetServer(serverId: string): void;
  reset(): void;
}

// Троттлинг PUT /read по каналам. Модульный, а не в сторе: таймеры — не
// состояние для рендера.
const windows = new Map<string, { trailing: string | null; timer: ReturnType<typeof setTimeout> | undefined }>();
let lastRehydrate = 0;

function requestRehydrate() {
  const now = Date.now();
  if (now - lastRehydrate < REHYDRATE_MIN_GAP_MS) return;
  lastRehydrate = now;
  void useUnreadStore.getState().hydrate();
}

async function sendMark(channelId: string, messageId: string) {
  try {
    const res = await apiService.markChannelRead(channelId, messageId);
    const serverCursor: CursorPos = { at: res.last_read_at, id: res.last_read_message_id };
    useUnreadStore.setState((s) => {
      const st = s.channels[channelId];
      if (!st) return s;
      // Ответы приходят не по порядку, а оптимистичный курсор может уже уйти
      // дальше: count из ответа про более ранний курсор устарел.
      if (comparePos(serverCursor, st.cursor) < 0) return s;
      return { channels: { ...s.channels, [channelId]: { ...st, cursor: serverCursor, count: res.count } } };
    });
  } catch (err) {
    logger.error('failed to mark channel read', err, { module: 'unread' });
  }
}

function scheduleMark(channelId: string, messageId: string) {
  const open = windows.get(channelId);
  if (open) {
    open.trailing = messageId;
    return;
  }
  const win = { trailing: null as string | null, timer: undefined as ReturnType<typeof setTimeout> | undefined };
  windows.set(channelId, win);
  void sendMark(channelId, messageId);
  win.timer = setTimeout(() => {
    windows.delete(channelId);
    if (win.trailing) void sendMark(channelId, win.trailing);
  }, MARK_READ_WINDOW_MS);
}

export const useUnreadStore = create<UnreadState>((set, get) => ({
  channels: {},
  othersRead: {},

  hydrate: async () => {
    try {
      const list = await apiService.getUnread();
      const prev = get().channels;
      const channels: Record<string, ChannelUnreadState> = {};
      for (const u of list) {
        const cursor: CursorPos = { at: u.last_read_at, id: u.last_read_message_id };
        const local = prev[u.channel_id];
        // Снимок мог уйти до того, как долетел наш PUT: локальный курсор
        // впереди — он и его счётчик свежее.
        channels[u.channel_id] = local && comparePos(local.cursor, cursor) > 0
          ? local
          : { serverId: u.server_id, count: u.count, cursor };
      }
      set({ channels });
    } catch (err) {
      logger.error('failed to load unread counters', err, { module: 'unread' });
    }
  },

  applyActivity: (ev, selfId) => {
    const st = get().channels[ev.channel_id];
    if (!st) {
      // Канал, которого не было в снимке (новый канал, только что вступили
      // в сервер): ни курсора, ни сервера не знаем — берём свежий снимок.
      requestRehydrate();
      return;
    }
    if (ev.author_user_id !== null && ev.author_user_id === selfId) return;
    if (!isAfter({ at: ev.created_at, id: ev.message_id }, st.cursor)) return;
    // На потолке реальное число неизвестно (сервер дальше 100 не считал):
    // минус один мог бы показать 99 вместо «99+».
    if (ev.op === 'delete' && st.count >= UNREAD_CAP) return;
    const count = Math.max(0, st.count + (ev.op === 'create' ? 1 : -1));
    set((s) => ({ channels: { ...s.channels, [ev.channel_id]: { ...st, count } } }));
  },

  applyChannelRead: (ev) => set((s) => {
    const pos: CursorPos = { at: ev.read_at, id: ev.message_id };
    const cur = s.othersRead[ev.channel_id];
    if (cur && comparePos(pos, cur) <= 0) return s;
    return { othersRead: { ...s.othersRead, [ev.channel_id]: pos } };
  }),

  loadReceipts: async (channelId) => {
    try {
      const r = await apiService.getReadReceipts(channelId);
      if (!r.others_max_read_at) return;
      get().applyChannelRead({ channel_id: channelId, read_at: r.others_max_read_at, message_id: r.others_max_read_message_id });
    } catch (err) {
      logger.error('failed to load read receipts', err, { module: 'unread' });
    }
  },

  markRead: (channelId, msg) => {
    const pos = msgPos(msg);
    const st = get().channels[channelId];
    if (st && comparePos(pos, st.cursor) <= 0) return;
    if (st) set((s) => ({ channels: { ...s.channels, [channelId]: { ...st, cursor: pos } } }));
    scheduleMark(channelId, msg.id);
  },

  forgetChannel: (channelId) => set((s) => {
    const { [channelId]: _gone, ...channels } = s.channels;
    const { [channelId]: _read, ...othersRead } = s.othersRead;
    return { channels, othersRead };
  }),

  forgetServer: (serverId) => set((s) => ({
    channels: Object.fromEntries(Object.entries(s.channels).filter(([, c]) => c.serverId !== serverId)),
  })),

  reset: () => {
    // Хвостовые таймеры прошлой сессии (или прошлого теста) не должны
    // отправить PUT и стереть окно, открытое уже после сброса.
    for (const w of windows.values()) clearTimeout(w.timer);
    windows.clear();
    lastRehydrate = 0;
    set({ channels: {}, othersRead: {} });
  },
}));

export const selectChannelUnread = (channelId: string) => (s: UnreadState): number => s.channels[channelId]?.count ?? 0;

export const selectServerUnread = (serverId: string) => (s: UnreadState): number => {
  let n = 0;
  for (const c of Object.values(s.channels)) if (c.serverId === serverId) n += c.count;
  return n;
};

export function formatUnread(n: number): string {
  return n > 99 ? '99+' : String(n);
}

/**
 * Якорь разделителя «новые сообщения»: первое сообщение строго после курсора.
 * Нет курсора (стор ещё не загрузился) — разделителя нет.
 */
export function firstUnreadId(cursor: CursorPos | undefined, messages: Message[]): string | null {
  if (!cursor || messages.length === 0) return null;
  const found = messages.find((m) => m.kind !== 'call' && isAfter(msgPos(m), cursor));
  return found ? found.id : null;
}
