import type { WSMessage } from '@/types';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080';

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private listeners: Map<string, Set<(payload: unknown) => void>> = new Map();
  private token: string | null = null;
  private isConnected = false;

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
        this.ws?.addEventListener('message', this.handleMessage);
        this.ws?.addEventListener('close', this.handleClose);
        this.ws?.addEventListener('error', this.handleError);
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      this.ws.onerror = () => {
        if (!settled) {
          settled = true;
          // Schedule retry after 3 seconds
          this.reconnectTimer = window.setTimeout(() => {
            if (this.token) {
              this.connect(this.token).catch(() => {});
            }
          }, 3000);
          reject(new Error('WebSocket connection failed'));
        }
      };
    });
  }

  disconnect(): void {
    this.cleanup();
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
      console.error('Failed to parse WebSocket message:', error);
    }
  };

  private handleClose = (): void => {
    this.isConnected = false;
    // Attempt to reconnect after 3 seconds
    this.reconnectTimer = window.setTimeout(() => {
      if (this.token) {
        this.connect(this.token).catch(console.error);
      }
    }, 3000);
  };

  private handleError = (error: Event): void => {
    console.error('WebSocket error:', error);
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket is not connected');
      return;
    }

    const message: WSMessage = {
      type: eventType,
      payload,
    };

    this.ws.send(JSON.stringify(message));
  }

  sendPing(): void {
    this.send('ping', {});
  }

  get connected(): boolean {
    return this.isConnected;
  }
}

export const wsService = new WebSocketService();
