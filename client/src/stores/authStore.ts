import { create } from 'zustand';
import type { User, AuthState } from '@/types';

const TOKEN_KEY = 'vycord_token';
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
  token: localStorage.getItem(TOKEN_KEY),
  isAuthenticated: !!localStorage.getItem(TOKEN_KEY),

  login: (token: string, user: User) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ token, user, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ token: null, user: null, isAuthenticated: false });
  },

  updateUser: (patch: Partial<User>) => {
    set((state) => {
      if (!state.user) return state;
      const user = { ...state.user, ...patch };
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      return { user };
    });
  },
}));
