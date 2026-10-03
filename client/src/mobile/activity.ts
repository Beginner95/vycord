import { useUnreadStore, selectChannelUnread, selectServerUnread } from '@/stores/unreadStore';

export interface ActivityPreview {
  authorName: string;
  kind: 'text' | 'attachment' | 'sticker' | 'call';
  text?: string;               // только для kind === 'text'
}

export interface ChannelActivity {
  preview: ActivityPreview | null;
  timestamp: string | null;    // ISO 8601
  unreadCount: number | null;  // null — число неизвестно
  hasUnread: boolean;          // «есть непрочитанное» (точка без числа)
}

type Override = ((id: string, scope: 'channel' | 'server') => ChannelActivity | null) | null;

// Превью последнего сообщения сервер не отдаёт (вне рамок VYC-104) — только
// счётчик непрочитанного из unreadStore. Override — для тестов и проб.
let override: Override = null;

/** Только для тестов и проб. */
export function __setActivityOverride(fn: Override): void {
  override = fn;
}

function fromCount(count: number): ChannelActivity | null {
  return count > 0 ? { preview: null, timestamp: null, unreadCount: count, hasUnread: true } : null;
}

export function useChannelActivity(channelId: string): ChannelActivity | null {
  const count = useUnreadStore(selectChannelUnread(channelId));
  return override ? override(channelId, 'channel') : fromCount(count);
}

export function useServerActivity(serverId: string): ChannelActivity | null {
  const count = useUnreadStore(selectServerUnread(serverId));
  return override ? override(serverId, 'server') : fromCount(count);
}
