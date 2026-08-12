import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore, ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY } from '@/stores/authStore';
import type { User } from '@/types';

const user: User = { id: '1', username: 'test', email: 't@example.com', status: 'online' } as User;

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false });
  });

  it('login stores both tokens and marks authenticated', () => {
    useAuthStore.getState().login('access-1', 'refresh-1', user);

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('access-1');
    expect(state.refreshToken).toBe('refresh-1');
    expect(state.isAuthenticated).toBe(true);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('access-1');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('refresh-1');
  });

  it('replaceTokens updates tokens without touching user', () => {
    useAuthStore.getState().login('access-1', 'refresh-1', user);
    useAuthStore.getState().replaceTokens('access-2', 'refresh-2');

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('access-2');
    expect(state.refreshToken).toBe('refresh-2');
    expect(state.isAuthenticated).toBe(true);
    expect(state.user).toEqual(user);
  });

  it('logout clears both tokens and localStorage', () => {
    useAuthStore.getState().login('access-1', 'refresh-1', user);
    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  });

  it('syncFromStorage re-reads tokens from localStorage', () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'external-access');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'external-refresh');

    useAuthStore.getState().syncFromStorage();

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('external-access');
    expect(state.refreshToken).toBe('external-refresh');
  });
});
