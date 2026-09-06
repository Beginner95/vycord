export type AttachmentKind = 'image' | 'video' | 'audio' | 'file';

export interface Attachment {
  id: string;
  channel_id: string;
  user_id: string;
  message_id?: string;
  kind: AttachmentKind;
  file_name: string;
  content_type: string;
  size_bytes: number;
  width?: number;
  height?: number;
  /** Подписанная ссылка на содержимое. Протухает — тогда см. getAttachment. */
  url: string;
  /** Только для картинок. */
  thumb_url?: string;
  created_at: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  avatar_url?: string;
  status: UserStatus;
  created_at: string;
  updated_at: string;
  show_last_seen: boolean;
  allow_friend_requests?: PrivacyMode;
  allow_dm_from?: PrivacyMode;
}

export type UserStatus = 'online' | 'idle' | 'dnd' | 'offline';

export type PrivacyMode = 'everyone' | 'mutual_servers' | 'none' | 'friends';

export interface UserBrief {
  user_id: string;
  username: string;
  avatar_url?: string | null;
}

/** Профиль друга: поля UserBrief приходят ПЛОСКИМИ (Go встраивает структуру). */
export interface FriendProfile extends UserBrief {
  friends_since: string;
}

/** Заявка: собеседник приходит ВЛОЖЕННЫМ полем user — в отличие от FriendProfile. */
export interface FriendRequest {
  id: string;
  user: UserBrief;
  created_at: string;
}

export interface Server {
  id: string;
  name: string;
  icon_url?: string;
  owner_id: string;
  is_private: boolean;
  created_at: string;
  updated_at: string;
}

export interface Channel {
  id: string;
  server_id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Invite {
  code: string;
  server_id: string;
  created_by: string;
  created_at: string;
  expires_at?: string;
  max_uses?: number;
  uses: number;
}

export interface InvitePreview {
  server_id: string;
  server_name: string;
  icon_url?: string;
  member_count: number;
}

export interface Sticker {
  id: string;
  server_id: string;
  name: string;
  image_url: string;
  created_by: string;
  created_at: string;
}

export interface Message {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  /** 'call' rows are a system placard, not a chat message — see CallEventRow. */
  kind: 'user' | 'call';
  attachments?: Attachment[];
  sticker_id?: string;
  sticker?: Sticker;
  /** Present only when kind === 'call'. null while the call is ongoing. */
  call_started_at?: string;
  call_ended_at?: string | null;
  /** Every user who was ever in the call, starter included, join order.
   * Only meaningful once call_ended_at is set — the active placard never
   * shows a live-updating list (see CallEventRow). */
  call_participant_ids?: string[];
  created_at: string;
  updated_at: string;
}

export interface MessageWithAuthor extends Message {
  username: string;
}

export interface MessageSearchResponse {
  results: MessageWithAuthor[];
  total: number;
}

export interface Member {
  server_id: string;
  user_id: string;
  joined_at: string;
}

/** Роль сервера. permissions приходит строкой: 64-битная маска не переживает JSON-число. */
export interface Role {
  id: string;
  server_id: string;
  name: string;
  color: number;
  position: number;
  permissions: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/** Эффективные права пользователя на сервере (клиентское представление). */
export interface PermissionSet {
  isOwner: boolean;
  bits: bigint;
  highestPosition: number;
}

/** Сырой ответ GET /servers/{id}/members/me/permissions. */
export interface PermissionsResponse {
  is_owner: boolean;
  permissions: string;
  highest_position: number;
}

export interface MemberWithUser {
  user_id: string;
  username: string;
  avatar_url?: string;
  roles: string[];
  joined_at: string;
}

export interface LastSeenInfo {
  last_seen_at: string | null;
  visible: boolean;
}

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  login: (accessToken: string, refreshToken: string, user: User) => void;
  replaceTokens: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
  updateUser: (patch: Partial<User>) => void;
  syncFromStorage: () => void;
}

export interface WSMessage {
  type: string;
  payload: unknown;
}
