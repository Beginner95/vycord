import { create } from 'zustand';

type Theme = 'light' | 'dark';

const THEME_KEY = 'vycord_theme';

/** --canvas светлой/тёмной темы (tokens.css). Мета-тег theme-color и манифест
 *  не читают CSS-переменные, поэтому это литералы — исключение, записанное в
 *  design-system.md. Меняешь --canvas — меняй и здесь, и в index.html. */
export const THEME_COLOR: Record<Theme, string> = { light: '#FFFFFF', dark: '#0E1017' };

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  window.electronAPI?.setTheme?.(theme);
  // Тема приложения может расходиться с системной: переписываем оба
  // media-варианта, иначе системная тема перекрасила бы статус-бар PWA.
  document.querySelectorAll?.('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', THEME_COLOR[theme]));
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
