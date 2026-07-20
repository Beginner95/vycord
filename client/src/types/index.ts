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
  created_at: string;
  updated_at: string;
}

export type ChannelType = 'text' | 'voice';

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
  role: Role;
  joined_at: string;
}

export type Role = 'owner' | 'admin' | 'member';

export interface MemberWithUser {
  user_id: string;
  username: string;
  avatar_url?: string;
  role: Role;
  joined_at: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
}

export interface WSMessage {
  type: string;
  payload: unknown;
}
