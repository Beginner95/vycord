// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  document.head.innerHTML =
    '<meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)">' +
    '<meta name="theme-color" content="#0E1017" media="(prefers-color-scheme: dark)">';
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  localStorage.clear();
});

describe('themeStore → meta theme-color', () => {
  it('an explicit app theme overrides both media-scoped metas', async () => {
    const { useThemeStore, THEME_COLOR } = await import('@/stores/themeStore');
    useThemeStore.getState().setTheme('dark');
    const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
    expect(metas.map((m) => m.getAttribute('content'))).toEqual([THEME_COLOR.dark, THEME_COLOR.dark]);
    useThemeStore.getState().setTheme('light');
    expect(metas.map((m) => m.getAttribute('content'))).toEqual([THEME_COLOR.light, THEME_COLOR.light]);
  });

  it('colors match the canvas tokens', async () => {
    const { THEME_COLOR } = await import('@/stores/themeStore');
    expect(THEME_COLOR).toEqual({ light: '#FFFFFF', dark: '#0E1017' });
  });
});
