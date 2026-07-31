import { create } from 'zustand';

export type Locale = 'ru' | 'en';

export const LOCALES: readonly Locale[] = ['ru', 'en'];

const LOCALE_KEY = 'vycord_locale';

function applyLocale(locale: Locale) {
  document.documentElement.setAttribute('lang', locale);
}

function getInitialLocale(): Locale {
  const stored = localStorage.getItem(LOCALE_KEY) as Locale | null;
  return stored && (LOCALES as readonly string[]).includes(stored) ? stored : 'ru';
}

const initialLocale = getInitialLocale();
applyLocale(initialLocale);

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: initialLocale,
  setLocale: (locale) => {
    localStorage.setItem(LOCALE_KEY, locale);
    applyLocale(locale);
    set({ locale });
  },
}));
