import { API_BASE_URL } from './api';
import { logger } from '@/utils/logger';
import type { GuestChatMessage } from './guestApi';

/**
 * Сокет гостя — единственный канал реального времени, который у него есть.
 * Токен сессии уходит ПЕРВЫМ КАДРОМ, а не в query: иначе он попал бы в логи
 * nginx (docs/superpowers/specs/2026-09-17-guest-call-link-design.md, У10).
 */

export interface GuestParticipantUser {
  user_id: string;
  username?: string;
  avatar_url?: string;
}

export interface GuestParticipantGuest {
  id: string;
  guest_id?: string;
  display_name: string;
}

export type GuestGatewayEvent =
  | { type: 'lobby_waiting' }
  | { type: 'admitted'; room_id: string }
  | { type: 'rejected' }
  | { type: 'lobby_timeout' }
  | { type: 'kicked'; reason: string }
  | { type: 'call_ended' }
  | { type: 'participants'; users: GuestParticipantUser[]; guests: GuestParticipantGuest[] }
  | { type: 'chat_message'; message: GuestChatMessage }
  | { type: 'message_delete'; id: string }
  | { type: 'peer_signal'; signal: string; userId: string; payload: Record<string, unknown> }
  | { type: 'closed' };

/** Сигналы других участников, которые сервер зеркалит гостю. */
const PEER_SIGNALS = new Set([
  'mic_muted',
  'mic_unmuted',
  'screen_share_started',
  'screen_share_stopped',
  'connection_quality',
]);

/** После этих событий переподключаться незачем: гостя в звонке больше нет. */
const TERMINAL = new Set(['rejected', 'lobby_timeout', 'kicked', 'call_ended']);

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

function gatewayUrl(): string {
  const base = API_BASE_URL.replace(/^http/, 'ws');
  return `${base}/api/v1/guest/ws`;
}

class GuestGateway {
  private socket: WebSocket | null = null;
  private token: string | null = null;
  private onEvent: ((e: GuestGatewayEvent) => void) | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  connect(sessionToken: string, onEvent: (e: GuestGatewayEvent) => void): void {
    this.disconnect();
    this.token = sessionToken;
    this.onEvent = onEvent;
    this.stopped = false;
    this.attempt = 0;
    this.open();
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.close();
    }
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === 1;
  }

  send(type: string, payload: Record<string, unknown> = {}): void {
    if (!this.isConnected()) return;
    this.socket?.send(JSON.stringify({ type, payload }));
  }

  private open(): void {
    const token = this.token;
    if (!token || this.stopped) return;

    const socket = new WebSocket(gatewayUrl());
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      socket.send(JSON.stringify({ type: 'auth', payload: { token } }));
    };

    socket.onmessage = (event) => {
      let frame: { type?: string; payload?: Record<string, unknown> };
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!frame.type) return;
      const translated = this.translate(frame.type, frame.payload ?? {});
      if (!translated) return;
      if (TERMINAL.has(frame.type)) {
        // Сокет сейчас закроется сервером; переподключаться не нужно.
        this.stopped = true;
      }
      this.onEvent?.(translated);
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.onEvent?.({ type: 'closed' });
      if (this.stopped) return;
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      logger.report('[guest] gateway socket error');
    };
  }

  private scheduleReconnect(): void {
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)];
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private translate(type: string, payload: Record<string, unknown>): GuestGatewayEvent | null {
    switch (type) {
      case 'lobby_waiting':
        return { type: 'lobby_waiting' };
      case 'admitted':
        return { type: 'admitted', room_id: String(payload.room_id ?? '') };
      case 'rejected':
        return { type: 'rejected' };
      case 'lobby_timeout':
        return { type: 'lobby_timeout' };
      case 'kicked':
        return { type: 'kicked', reason: String(payload.reason ?? 'kicked') };
      case 'call_ended':
        return { type: 'call_ended' };
      case 'participants':
        return {
          type: 'participants',
          users: (payload.users as GuestParticipantUser[]) ?? [],
          guests: (payload.guests as GuestParticipantGuest[]) ?? [],
        };
      case 'chat_message':
        return { type: 'chat_message', message: payload as unknown as GuestChatMessage };
      case 'message_delete':
        return { type: 'message_delete', id: String(payload.id ?? '') };
      case 'pong':
        return null;
      default:
        if (PEER_SIGNALS.has(type)) {
          return { type: 'peer_signal', signal: type, userId: String(payload.user_id ?? ''), payload };
        }
        return null;
    }
  }
}

export const guestGateway = new GuestGateway();
