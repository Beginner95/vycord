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

// Серверных меток прочтения ещё нет (спека §0: превью и счётчики — вне границ
// VYC-95). Хуки возвращают null, строки списков это понимают и выглядят как в
// §5.2/§5.3. Когда появится API, меняются ТОЛЬКО тела этих двух хуков.
let override: Override = null;

/** Только для тестов и проб. */
export function __setActivityOverride(fn: Override): void {
  override = fn;
}

export function useChannelActivity(channelId: string): ChannelActivity | null {
  return override ? override(channelId, 'channel') : null;
}

export function useServerActivity(serverId: string): ChannelActivity | null {
  return override ? override(serverId, 'server') : null;
}
