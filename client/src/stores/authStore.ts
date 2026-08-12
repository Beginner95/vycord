import { create } from 'zustand';
import type { User, AuthState } from '@/types';

export const ACCESS_TOKEN_KEY = 'vycord_access_token';
export const REFRESH_TOKEN_KEY = 'vycord_refresh_token';
const USER_KEY = 'vycord_user';

function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: getStoredUser(),
  accessToken: localStorage.getItem(ACCESS_TOKEN_KEY),
  refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY),
  isAuthenticated: !!localStorage.getItem(REFRESH_TOKEN_KEY),

  login: (accessToken: string, refreshToken: string, user: User) => {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ accessToken, refreshToken, user, isAuthenticated: true });
  },

  replaceTokens: (accessToken: string, refreshToken: string) => {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    set({ accessToken, refreshToken });
  },

  logout: () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ accessToken: null, refreshToken: null, user: null, isAuthenticated: false });
  },

  updateUser: (patch: Partial<User>) => {
    set((state) => {
      if (!state.user) return state;
      const user = { ...state.user, ...patch };
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      return { user };
    });
  },

  syncFromStorage: () => {
    set({
      accessToken: localStorage.getItem(ACCESS_TOKEN_KEY),
      refreshToken: localStorage.getItem(REFRESH_TOKEN_KEY),
    });
  },
}));
