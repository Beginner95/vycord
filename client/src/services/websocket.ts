import type { WSMessage } from '@/types';
import { logger } from '@/utils/logger';
import { computeBackoffDelay } from '@/services/backoff';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080';

/**
 * Сколько соединение должно прожить, чтобы попытка засчиталась успешной и
 * backoff обнулился. Handshake при вытеснении всегда успешен (сервер отвечает
 * 101 и только потом рвёт сокет), поэтому сброс счётчика по `onopen` держал
 * задержку на минимуме вечно: две сессии одного пользователя выбивали друг
 * друга по два раза в секунду сутки напролёт.
 */
const MIN_HEALTHY_CONNECTION_MS = 10_000;

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  // Consecutive failed attempts since the last successful open — grows the
  // backoff ceiling computeBackoffDelay draws from, reset to 0 in handleClose
  // once the connection has proven itself healthy (see MIN_HEALTHY_CONNECTION_MS).
  private reconnectAttempt = 0;
  // Момент последнего успешного `open`; null — соединение ни разу не открылось.
  private openedAt: number | null = null;
  private listeners: Map<string, Set<(payload: unknown) => void>> = new Map();
  private token: string | null = null;
  private isConnected = false;
  private pendingMessages: string[] = [];

  connect(token: string): Promise<void> {
    if (this.isConnected) {
      return Promise.resolve();
    }

    // Don't create duplicate connections
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      return new Promise((resolve, reject) => {
        const origOnopen = this.ws!.onopen;
        const origOnerror = this.ws!.onerror;
        this.ws!.onopen = (e) => {
          this.isConnected = true;
          if (origOnopen) origOnopen.call(this.ws!, e);
          resolve();
        };
        this.ws!.onerror = (e) => {
          if (origOnerror) origOnerror.call(this.ws!, e);
          reject(new Error('WebSocket connection failed'));
        };
      });
    }

    this.token = token;
    this.cleanup();

    return new Promise((resolve, reject) => {
      const wsUrl = `${WS_URL}/ws?token=${token}`;
      this.ws = new WebSocket(wsUrl);

      let settled = false;

      this.ws.onopen = () => {
        this.isConnected = true;
        this.openedAt = Date.now();
        this.ws?.addEventListener('message', this.handleMessage);
        this.ws?.addEventListener('close', this.handleClose);
        this.ws?.addEventListener('error', this.handleError);
        // Flush messages queued before the connection was ready
        const pending = this.pendingMessages.splice(0);
        for (const data of pending) {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(data);
          }
        }
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      this.ws.onerror = () => {
        if (!settled) {
          settled = true;
          this.scheduleReconnect(() => {
            if (this.token) {
              this.connect(this.token).catch(() => {});
            }
          });
          reject(new Error('WebSocket connection failed'));
        }
      };
    });
  }

  disconnect(): void {
    this.cleanup();
    this.reconnectAttempt = 0;
    this.openedAt = null;
  }

  /**
   * Обновляет токен для будущих (пере)подключений, не разрывая текущее.
   * JWT проверяется только на этапе handshake, поэтому уже открытое
   * соединение продолжает работать и после истечения токена; но без этого
   * метода реконнект после сетевого сбоя предъявит серверу мёртвый токен.
   */
  updateToken(token: string): void {
    this.token = token;
  }

  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.pendingMessages = [];
  }

  private handleMessage = (event: MessageEvent): void => {
    try {
      const message: WSMessage = JSON.parse(event.data);
      const listenerSet = this.listeners.get(message.type);
      if (listenerSet) {
        listenerSet.forEach((listener) => listener(message.payload));
      }

      // Also dispatch custom events for CallUI
      window.dispatchEvent(
        new CustomEvent(`discrod:${message.type}`, { detail: message.payload })
      );
    } catch (error) {
      logger.error('Failed to parse WebSocket message:', error, { module: 'ws' });
    }
  };

  private handleClose = (): void => {
    this.isConnected = false;
    // Успешной считается не открывшаяся, а прожившая попытка — иначе счётчик
    // обнуляется вытеснением и backoff никогда не растёт.
    if (this.openedAt !== null && Date.now() - this.openedAt >= MIN_HEALTHY_CONNECTION_MS) {
      this.reconnectAttempt = 0;
    }
    this.openedAt = null;
    this.scheduleReconnect(() => {
      if (this.token) {
        this.connect(this.token).catch((err) => logger.error('WebSocket reconnect failed:', err, { module: 'ws' }));
      }
    });
  };

  // Schedules onFire after an exponential-backoff-with-full-jitter delay
  // (computeBackoffDelay), bumping reconnectAttempt so the ceiling keeps
  // growing across consecutive failures. Replaces a fixed 3-second delay:
  // after a server drop, every client used to hammer it again on the exact
  // same cadence — full jitter spreads that out immediately, and the growing
  // ceiling stops hammering a server that stays down.
  private scheduleReconnect(onFire: () => void): void {
    const delay = computeBackoffDelay(this.reconnectAttempt);
    this.reconnectAttempt++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      onFire();
    }, delay);
  }

  private handleError = (error: Event): void => {
    const socket = error.target as WebSocket | null;
    logger.error('WebSocket error:', error, { module: 'ws', readyState: String(socket?.readyState) });
  };

  on(eventType: string, listener: (payload: unknown) => void): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.get(eventType)?.delete(listener);
    };
  }

  send(eventType: string, payload: unknown): void {
    const message: WSMessage = { type: eventType, payload };
    const data = JSON.stringify(message);

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Buffer messages sent before the connection is ready; flushed in onopen.
      this.pendingMessages.push(data);
      return;
    }

    this.ws.send(data);
  }

  sendPing(): void {
    this.send('ping', {});
  }

  get connected(): boolean {
    return this.isConnected;
  }
}

export const wsService = new WebSocketService();
