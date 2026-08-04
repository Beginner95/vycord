export interface User {
  id: string;
  username: string;
  email: string;
  avatar_url?: string;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

export type UserStatus = 'online' | 'idle' | 'dnd' | 'offline';

export interface Server {
  id: string;
  name: string;
  icon_url?: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface Channel {
  id: string;
  server_id: string;
  name: string;
  type: ChannelType;
  position: number;
  is_private: boolean;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export type ChannelType = 'text' | 'voice';

export interface ChannelMember {
  user_id: string;
  username: string;
  avatar_url?: string;
  invited_by: string;
  invited_at: string;
}

export interface Message {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  attachments?: string[];
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

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  updateUser: (patch: Partial<User>) => void;
}

export interface WSMessage {
  type: string;
  payload: unknown;
}
