import { useAuthStore } from '@/stores/authStore';
import type { Server, User, Role, PermissionsResponse, Invite, InvitePreview, Sticker } from '@/types';
import { hasKey, type TFunc, type TKey } from '@/i18n';
import { decodeJwtExpMs } from '@/utils/jwt';
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY } from '@/stores/authStore';
import { wsService } from '@/services/websocket';

const REFRESH_BUFFER_MS = 60_000;

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

export function resolveUploadUrl(url?: string): string | undefined {
  if (!url) return url;
  return url.startsWith('/') ? `${API_BASE_URL}${url}` : url;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Текст ошибки API для показа пользователю.
 *
 * Переводит по стабильному code с сервера. Фолбэк на серверный текст
 * обязателен: если код клиенту неизвестен (старый клиент против нового
 * сервера или наоборот), пользователь увидит ровно то же, что видел до
 * появления локализации, — регрессии не будет ни при каком рассинхроне.
 */
export function apiErrorText(err: unknown, t: TFunc): string {
  if (err instanceof ApiError && err.code) {
    const key = `errors.${err.code}`;
    if (hasKey(key)) return t(key as TKey);
  }
  if (err instanceof Error && err.message) return err.message;
  return t('errors.unknown');
}

class ApiService {
  private refreshPromise: Promise<string> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  private getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  }

  private getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    const token = this.getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Обменивает текущий refresh-токен на новую пару. Дедуплицирует
   * конкурентные вызовы одним in-flight промисом — критично из-за ротации:
   * без дедупа два параллельных 401 предъявят один и тот же (уже
   * ротированный первым вызовом) refresh-токен, и второй ложно словит
   * server-side reuse-detection, сжигая всю сессию.
   */
  private async refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      throw new Error('no refresh token available');
    }

    this.refreshPromise = (async () => {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (response.status === 401) {
        useAuthStore.getState().logout();
        throw new ApiError('Session expired', 'invalid_or_expired_token', 401);
      }
      if (!response.ok) {
        throw new Error(`refresh failed: HTTP ${response.status}`);
      }

      const data = (await response.json()) as { access_token: string; refresh_token: string; user: User };
      useAuthStore.getState().replaceTokens(data.access_token, data.refresh_token);
      wsService.updateToken(data.access_token);
      this.scheduleTokenRefresh(data.access_token);
      return data.access_token;
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Ставит таймер на тихое обновление access-токена за REFRESH_BUFFER_MS
   * до истечения. В норме это единственный путь обновления — реактивный
   * retry-after-401 в request()/requestForm() существует только как
   * страховка на случай пропущенного таймера (сон устройства и т.п.).
   */
  scheduleTokenRefresh(accessToken: string): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    const expMs = decodeJwtExpMs(accessToken);
    if (expMs === null) return;

    const delay = Math.max(0, expMs - Date.now() - REFRESH_BUFFER_MS);
    this.refreshTimer = setTimeout(() => {
      // На момент срабатывания пользователь мог уже разлогиниться —
      // тогда просто ничего не делаем, а не падаем.
      if (this.getRefreshToken()) {
        this.refreshAccessToken().catch(() => {});
      }
    }, delay);
  }

  /**
   * Возвращает access-токен, гарантированно не близкий к истечению —
   * обновляя его при необходимости. Используется там, где обновление
   * нужно синхронизировать с конкретным действием (подключение WS,
   * bootstrap), а не просто положиться на фоновый таймер.
   */
  async getFreshAccessToken(): Promise<string | null> {
    if (!this.getRefreshToken()) return null;

    const accessToken = this.getAccessToken();
    const expMs = accessToken ? decodeJwtExpMs(accessToken) : null;
    const isFresh = expMs !== null && expMs - Date.now() > REFRESH_BUFFER_MS;
    if (isFresh) return accessToken;

    try {
      return await this.refreshAccessToken();
    } catch {
      return null;
    }
  }

  /** Best-effort отзыв текущей сессии на сервере; локальное состояние чистит вызывающая сторона. */
  async logout(): Promise<void> {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return;
    try {
      await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
    } catch {
      // Логаут best-effort: сеть недоступна — сервер сам вычистит запись по expires_at.
    }
  }

  /**
   * Вызывается один раз при старте приложения (main.tsx). Пытается сразу
   * освежить access-токен, если он уже устарел, и подписывается на два
   * триггера для остального времени жизни приложения: возврат вкладки в
   * фокус (сон устройства/фоновый троттлинг мог пропустить таймер) и
   * изменение localStorage из другой вкладки (чтобы не предъявить уже
   * ротированный другой вкладкой refresh-токен и не словить ложный
   * reuse-detect).
   */
  initAuthLifecycle(): void {
    void this.getFreshAccessToken();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void this.getFreshAccessToken();
      }
    });

    window.addEventListener('storage', (event) => {
      const e = event as StorageEvent;
      if (e.key === ACCESS_TOKEN_KEY || e.key === REFRESH_TOKEN_KEY) {
        useAuthStore.getState().syncFromStorage();
      }
    });
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retried = false
  ): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers,
      },
    });

    if (response.status === 401) {
      const body = await response.json().catch(() => ({ error: 'Unauthorized' }));
      if (body.code === 'invalid_or_expired_token' && !retried && this.getRefreshToken()) {
        try {
          await this.refreshAccessToken();
          return this.request<T>(endpoint, options, true);
        } catch {
          // refreshAccessToken() уже разлогинил при 401; при сетевой
          // ошибке сессия остаётся жива — просто отдаём исходную ошибку.
        }
      } else {
        useAuthStore.getState().logout();
      }
      throw new ApiError(body.error || 'Unauthorized', body.code, 401);
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: response.statusText }));
      throw new ApiError(body.error || `HTTP ${response.status}`, body.code, response.status);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  private async requestForm<T>(
    endpoint: string,
    options: RequestInit,
    retried = false
  ): Promise<T> {
    const headers: HeadersInit = {};
    const token = this.getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    if (response.status === 401) {
      const body = await response.json().catch(() => ({ error: 'Unauthorized' }));
      if (body.code === 'invalid_or_expired_token' && !retried && this.getRefreshToken()) {
        try {
          await this.refreshAccessToken();
          return this.requestForm<T>(endpoint, options, true);
        } catch {
          // см. комментарий в request()
        }
      } else {
        useAuthStore.getState().logout();
      }
      throw new ApiError(body.error || 'Unauthorized', body.code, 401);
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: response.statusText }));
      throw new ApiError(body.error || `HTTP ${response.status}`, body.code, response.status);
    }

    return response.json();
  }

  // Auth
  async register(username: string, email: string, password: string) {
    return this.request<{ access_token: string; refresh_token: string; user: User }>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
  }

  async login(email: string, password: string) {
    return this.request<{ access_token: string; refresh_token: string; user: User }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async getMe() {
    return this.request('/api/v1/auth/me');
  }

  // Users
  async searchUsers(query: string, limit = 20) {
    return this.request(`/api/v1/users?q=${encodeURIComponent(query)}&limit=${limit}`);
  }

  async getUserById(id: string) {
    return this.request(`/api/v1/users/${id}`);
  }

  async uploadAvatar(blob: Blob) {
    const formData = new FormData();
    formData.append('avatar', blob, 'avatar.jpg');
    return this.requestForm<User>('/api/v1/users/me/avatar', {
      method: 'POST',
      body: formData,
    });
  }

  async removeAvatar() {
    return this.requestForm<User>('/api/v1/users/me/avatar', {
      method: 'DELETE',
    });
  }

  // Servers
  async createServer(name: string, isPrivate = false) {
    return this.request('/api/v1/servers', {
      method: 'POST',
      body: JSON.stringify({ name, is_private: isPrivate }),
    });
  }

  async getServers() {
    return this.request('/api/v1/servers');
  }

  async searchServers(query: string, limit = 20) {
    return this.request(`/api/v1/servers/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  }

  async getServer(id: string) {
    return this.request(`/api/v1/servers/${id}`);
  }

  async joinServer(id: string) {
    return this.request(`/api/v1/servers/${id}/join`, {
      method: 'POST',
    });
  }

  async leaveServer(id: string) {
    return this.request(`/api/v1/servers/${id}/leave`, {
      method: 'POST',
    });
  }

  // isPrivate не передан (undefined) → JSON.stringify опускает ключ целиком —
  // бэкенд трактует отсутствие ключа как «не менять приватность» (см. UpdateServerRequest).
  async updateServer(id: string, name: string, isPrivate?: boolean) {
    return this.request(`/api/v1/servers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, is_private: isPrivate }),
    });
  }

  async deleteServer(id: string) {
    return this.request(`/api/v1/servers/${id}`, {
      method: 'DELETE',
    });
  }

  async uploadServerIcon(id: string, blob: Blob) {
    const formData = new FormData();
    formData.append('icon', blob, 'icon.jpg');
    return this.requestForm<Server>(`/api/v1/servers/${id}/icon`, {
      method: 'POST',
      body: formData,
    });
  }

  async removeServerIcon(id: string) {
    return this.requestForm<Server>(`/api/v1/servers/${id}/icon`, {
      method: 'DELETE',
    });
  }

  // Roles
  async getRoles(serverId: string): Promise<Role[]> {
    return this.request(`/api/v1/servers/${serverId}/roles`);
  }

  async createRole(
    serverId: string,
    body: { name: string; color?: number; position?: number; permissions?: string }
  ): Promise<Role> {
    return this.request(`/api/v1/servers/${serverId}/roles`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async updateRole(
    serverId: string,
    roleId: string,
    patch: { name?: string; color?: number; position?: number; permissions?: string }
  ): Promise<Role> {
    return this.request(`/api/v1/servers/${serverId}/roles/${roleId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async deleteRole(serverId: string, roleId: string): Promise<void> {
    return this.request(`/api/v1/servers/${serverId}/roles/${roleId}`, { method: 'DELETE' });
  }

  async assignRole(serverId: string, userId: string, roleId: string): Promise<void> {
    return this.request(`/api/v1/servers/${serverId}/members/${userId}/roles/${roleId}`, {
      method: 'PUT',
    });
  }

  async unassignRole(serverId: string, userId: string, roleId: string): Promise<void> {
    return this.request(`/api/v1/servers/${serverId}/members/${userId}/roles/${roleId}`, {
      method: 'DELETE',
    });
  }

  async getMyPermissions(serverId: string): Promise<PermissionsResponse> {
    return this.request(`/api/v1/servers/${serverId}/members/me/permissions`);
  }

  // Channels
  async createChannel(serverId: string, name: string, type: 'text' | 'voice' = 'text') {
    return this.request(`/api/v1/servers/${serverId}/channels`, {
      method: 'POST',
      body: JSON.stringify({ name, type }),
    });
  }

  async getChannels(serverId: string) {
    return this.request(`/api/v1/servers/${serverId}/channels`);
  }

  async getServerMembers(serverId: string) {
    return this.request(`/api/v1/servers/${serverId}/members`);
  }

  async updateChannel(serverId: string, channelId: string, name: string) {
    return this.request(`/api/v1/servers/${serverId}/channels/${channelId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  }

  // Invites
  async createInvite(serverId: string): Promise<Invite> {
    return this.request(`/api/v1/servers/${serverId}/invites`, { method: 'POST' });
  }

  async listInvites(serverId: string): Promise<Invite[]> {
    return this.request(`/api/v1/servers/${serverId}/invites`);
  }

  async revokeInvite(serverId: string, code: string): Promise<void> {
    return this.request(`/api/v1/servers/${serverId}/invites/${code}`, { method: 'DELETE' });
  }

  async previewInvite(code: string): Promise<InvitePreview> {
    return this.request(`/api/v1/invites/${code}`);
  }

  async joinViaInvite(code: string): Promise<Server> {
    return this.request(`/api/v1/invites/${code}/join`, { method: 'POST' });
  }

  async getVoiceToken(channelId: string): Promise<{ token: string }> {
    return this.request(`/api/v1/channels/${channelId}/voice-token`, { method: 'POST' });
  }

  async deleteChannel(serverId: string, channelId: string) {
    return this.request(`/api/v1/servers/${serverId}/channels/${channelId}`, {
      method: 'DELETE',
    });
  }

  // Messages
  async createMessage(channelId: string, content: string, stickerId?: string) {
    return this.request(`/api/v1/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, sticker_id: stickerId }),
    });
  }

  async getMessages(channelId: string, limit = 50, offset = 0) {
    return this.request(`/api/v1/channels/${channelId}/messages?limit=${limit}&offset=${offset}`);
  }

  async searchMessages(channelId: string, query: string, limit = 25, offset = 0) {
    return this.request(
      `/api/v1/channels/${channelId}/messages/search?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`
    );
  }

  async getMessagesAround(channelId: string, messageId: string) {
    return this.request(`/api/v1/channels/${channelId}/messages/around/${messageId}`);
  }

  async updateMessage(channelId: string, messageId: string, content: string) {
    return this.request(`/api/v1/channels/${channelId}/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
  }

  async deleteMessage(channelId: string, messageId: string) {
    return this.request(`/api/v1/channels/${channelId}/messages/${messageId}`, {
      method: 'DELETE',
    });
  }

  // Stickers
  async listStickers(serverId: string) {
    return this.request<Sticker[]>(`/api/v1/servers/${serverId}/stickers`);
  }

  async uploadSticker(serverId: string, name: string, file: File) {
    const formData = new FormData();
    formData.append('image', file, file.name || `sticker-${Date.now()}.png`);
    formData.append('name', name);
    return this.requestForm<Sticker>(`/api/v1/servers/${serverId}/stickers`, {
      method: 'POST',
      body: formData,
    });
  }

  async deleteSticker(serverId: string, stickerId: string) {
    return this.requestForm<void>(`/api/v1/servers/${serverId}/stickers/${stickerId}`, {
      method: 'DELETE',
    });
  }

  async updateLastVisited(serverId: string | null, channelId: string | null) {
    return this.request('/api/v1/users/me/last-visited', {
      method: 'PUT',
      body: JSON.stringify({
        server_id: serverId,
        channel_id: channelId,
      }),
    });
  }

  // Online users
  async getOnlineUsers() {
    return this.request('/api/v1/users/online');
  }

  // TURN credentials for WebRTC (ephemeral, per-user)
  async getTurnCredentials() {
    return this.request<{
      ice_servers: Array<{ urls: string[]; username?: string; credential?: string }>;
      ttl: number;
    }>('/api/v1/turn/credentials');
  }
}

export const apiService = new ApiService();
