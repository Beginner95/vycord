import { useAuthStore } from '@/stores/authStore';
import type { User } from '@/types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

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
      useAuthStore.getState().logout();
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
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
