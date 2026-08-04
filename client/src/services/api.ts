import { useAuthStore } from '@/stores/authStore';
import type { Server, User, Role, PermissionsResponse, ChannelMember } from '@/types';
import { hasKey, type TFunc, type TKey } from '@/i18n';

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

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
  private getToken(): string | null {
    return localStorage.getItem('vycord_token');
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers,
      },
    });

    if (response.status === 401) {
      // Разлогин при 401 сохраняем без изменений (VYC-54).
      useAuthStore.getState().logout();
      // Но тело ответа больше не выбрасываем: 401 приходит и от /auth/login,
      // где code отличает «неверный пароль» от «истёкший токен».
      const body = await response.json().catch(() => ({ error: 'Unauthorized' }));
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

  private async requestForm<T>(endpoint: string, options: RequestInit): Promise<T> {
    const token = this.getToken();
    const headers: HeadersInit = {};
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
      // Разлогин при 401 сохраняем без изменений (VYC-54).
      useAuthStore.getState().logout();
      window.location.href = '/login';
      // Но тело ответа больше не выбрасываем: 401 приходит и от /auth/login,
      // где code отличает «неверный пароль» от «истёкший токен».
      const body = await response.json().catch(() => ({ error: 'Unauthorized' }));
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
    return this.request<{ token: string; user: User }>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
  }

  async login(email: string, password: string) {
    return this.request<{ token: string; user: User }>('/api/v1/auth/login', {
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
  async createServer(name: string) {
    return this.request('/api/v1/servers', {
      method: 'POST',
      body: JSON.stringify({ name }),
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

  async updateServer(id: string, name: string) {
    return this.request(`/api/v1/servers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
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
  async createChannel(serverId: string, name: string, type: 'text' | 'voice' = 'text', isPrivate = false) {
    return this.request(`/api/v1/servers/${serverId}/channels`, {
      method: 'POST',
      body: JSON.stringify({ name, type, is_private: isPrivate }),
    });
  }

  async getChannels(serverId: string) {
    return this.request(`/api/v1/servers/${serverId}/channels`);
  }

  async getServerMembers(serverId: string) {
    return this.request(`/api/v1/servers/${serverId}/members`);
  }

  async updateChannel(serverId: string, channelId: string, name: string, isPrivate: boolean) {
    return this.request(`/api/v1/servers/${serverId}/channels/${channelId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, is_private: isPrivate }),
    });
  }

  async getChannelMembers(serverId: string, channelId: string): Promise<ChannelMember[]> {
    return this.request(`/api/v1/servers/${serverId}/channels/${channelId}/members`);
  }

  async inviteToChannel(serverId: string, channelId: string, userId: string): Promise<void> {
    return this.request(`/api/v1/servers/${serverId}/channels/${channelId}/members`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  }

  async removeFromChannel(serverId: string, channelId: string, userId: string): Promise<void> {
    return this.request(`/api/v1/servers/${serverId}/channels/${channelId}/members/${userId}`, {
      method: 'DELETE',
    });
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
  async createMessage(channelId: string, content: string) {
    return this.request(`/api/v1/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
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
