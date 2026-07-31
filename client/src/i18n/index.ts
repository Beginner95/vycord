import { useMemo } from 'react';
import { useLocaleStore, type Locale } from '@/stores/localeStore';
import { ru, type Dictionary } from './locales/ru';
import { en } from './locales/en';
import type { PluralForms } from './plural';

export { plural } from './plural';
export { LOCALES } from '@/stores/localeStore';
export type { PluralForms } from './plural';
export type { Locale } from '@/stores/localeStore';

const DICTIONARIES: Record<Locale, Dictionary> = { ru, en };

/** Рекурсивно собирает точечные пути до строковых и плюральных листьев. */
type Leaves<T> = T extends string
  ? never
  : T extends PluralForms
    ? never
    : {
        [K in keyof T & string]: T[K] extends string
          ? K
          : T[K] extends PluralForms
            ? K
            : `${K}.${Leaves<T[K]>}`;
      }[keyof T & string];

export type TKey = Leaves<Dictionary>;
export type TVars = Record<string, string | number>;
export type TFunc = (key: TKey, vars?: TVars) => string;

function resolve(dict: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
    dict,
  );
}

function interpolate(template: string, vars?: TVars): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

function translate(locale: Locale, key: string, vars?: TVars): string {
  const value = resolve(DICTIONARIES[locale], key);
  // Отсутствие перевода не должно ронять экран: возвращаем сам ключ.
  if (typeof value !== 'string') return key;
  return interpolate(value, vars);
}

function translatePlural(locale: Locale, key: string, count: number, vars?: TVars): string {
  const forms = resolve(DICTIONARIES[locale], key) as PluralForms | undefined;
  if (!forms || typeof forms.other !== 'string') return key;
  const rule = new Intl.PluralRules(locale).select(count) as keyof PluralForms;
  const template = forms[rule] ?? forms.other;
  return interpolate(template, { ...vars, count });
}

/** Есть ли такой ключ в словаре. Нужен только для динамических ключей ошибок API. */
export function hasKey(key: string): boolean {
  const value = resolve(ru, key);
  return typeof value === 'string';
}

/** Прямой импорт — для сервисов, где нет хуков. Не реактивен. */
export const t: TFunc = (key, vars) => translate(useLocaleStore.getState().locale, key, vars);

export function tp(key: TKey, count: number, vars?: TVars): string {
  return translatePlural(useLocaleStore.getState().locale, key, count, vars);
}

/** Хук для компонентов: подписан на стор, вызывает перерисовку при смене языка. */
export function useT(): TFunc {
  const locale = useLocaleStore((s) => s.locale);
  return useMemo(() => (key: TKey, vars?: TVars) => translate(locale, key, vars), [locale]);
}

/** Плюральный хук, реактивный аналог tp. */
export function useTp(): (key: TKey, count: number, vars?: TVars) => string {
  const locale = useLocaleStore((s) => s.locale);
  return useMemo(
    () => (key: TKey, count: number, vars?: TVars) => translatePlural(locale, key, count, vars),
    [locale],
  );
}
