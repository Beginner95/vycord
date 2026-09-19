import { API_BASE_URL, ApiError } from './api';
import { STUN_SERVERS } from './iceConfig';
import type { CallCredentials } from './callCredentials';
import type { Attachment, Sticker } from '@/types';

/**
 * Гостевой клиент API. Никогда не использует токен аккаунта: у гостя есть
 * только непрозрачный сессионный токен, выданный на входе по ссылке
 * (docs/superpowers/specs/2026-09-17-guest-call-link-design.md, раздел 1).
 */

export interface GuestPreview {
  server_name: string;
  server_icon_url?: string;
  channel_name: string;
  participant_count: number;
}

export interface GuestJoinResult {
  guest_id: string;
  session_token: string;
  display_name: string;
}

export interface GuestChatAuthor {
  kind: 'user' | 'guest';
  user_id?: string;
  username?: string;
  avatar_url?: string;
  guest_id?: string;
  display_name?: string;
}

export interface GuestChatMessage {
  id: string;
  content: string;
  created_at: string;
  updated_at?: string;
  author: GuestChatAuthor;
  /** Вложения участников — с подписанными ссылками, открываются без аккаунта. */
  attachments?: Attachment[];
  sticker_id?: string;
  sticker?: Sticker;
}

interface TurnCredentialsResponse {
  ice_servers: { urls: string[]; username?: string; credential?: string }[];
  ttl: number;
}

let sessionToken: string | null = null;

async function request<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth && sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      // Пустое или не-JSON тело: остаётся только статус.
    }
    throw new ApiError(
      typeof body.error === 'string' ? body.error : `HTTP ${response.status}`,
      typeof body.code === 'string' ? body.code : undefined,
      response.status,
      body,
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const guestApi = {
  setSessionToken(token: string | null): void {
    sessionToken = token;
  },

  sessionToken(): string | null {
    return sessionToken;
  },

  preview(secret: string): Promise<GuestPreview> {
    // Секрет уходит только в теле: в query он попал бы в логи nginx.
    return request<GuestPreview>('/api/v1/guest/preview', {
      method: 'POST',
      body: JSON.stringify({ secret }),
    }, false);
  },

  async join(secret: string, displayName: string): Promise<GuestJoinResult> {
    const result = await request<GuestJoinResult>('/api/v1/guest/join', {
      method: 'POST',
      body: JSON.stringify({ secret, display_name: displayName }),
    }, false);
    sessionToken = result.session_token;
    return result;
  },

  voiceToken(): Promise<{ token: string; room_id: string }> {
    return request('/api/v1/guest/voice-token', { method: 'POST' });
  },

  async iceServers(): Promise<RTCIceServer[]> {
    try {
      const res = await request<TurnCredentialsResponse>('/api/v1/guest/turn-credentials');
      const turn = (res.ice_servers ?? [])
        .filter((s) => s.urls && s.urls.length > 0)
        .map((s) => ({ urls: s.urls, username: s.username, credential: s.credential }));
      return [...STUN_SERVERS, ...turn];
    } catch {
      // Без TURN звонок всё ещё возможен по STUN — молча деградируем, как и
      // у участника с аккаунтом.
      return STUN_SERVERS;
    }
  },

  messages(after?: string): Promise<GuestChatMessage[]> {
    const query = after ? `?after=${encodeURIComponent(after)}` : '';
    return request<GuestChatMessage[]>(`/api/v1/guest/messages${query}`);
  },

  async sendMessage(content: string): Promise<void> {
    await request('/api/v1/guest/messages', { method: 'POST', body: JSON.stringify({ content }) });
  },

  async leave(): Promise<void> {
    await request('/api/v1/guest/leave', { method: 'POST' });
  },

  credentials(): CallCredentials {
    return {
      getVoiceToken: async () => {
        const { token } = await guestApi.voiceToken();
        return { token };
      },
      getIceServers: () => guestApi.iceServers(),
    };
  },
};
