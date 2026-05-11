import { create } from 'zustand';

type Theme = 'light' | 'dark';

const THEME_KEY = 'vycord_theme';

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY) as Theme | null;
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const initialTheme = getInitialTheme();
applyTheme(initialTheme);

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initialTheme,
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },
}));
