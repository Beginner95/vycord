import { useMemo } from 'react';
import { useLocaleStore, type Locale } from '@/stores/localeStore';
import { ru } from './locales/ru';
import { en } from './locales/en';
import type { Dictionary } from './locales/ru';
import type { TFunc, TKey, TVars } from './index';

export const RU_MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

export const EN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * "45 сек" / "12 мин" / "1 ч 20 мин" — abbreviated units, never declined
 * (Russian "сек"/"мин"/"ч" don't take plural forms as abbreviations), so
 * this doesn't go through plural.ts/the t() dictionary — same
 * hardcoded-per-locale approach as RU_MONTHS_GENITIVE/EN_MONTHS above.
 */
export function formatCallDuration(totalSeconds: number, locale: Locale): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) {
    return locale === 'ru' ? `${seconds} сек` : `${seconds} sec`;
  }
  if (minutes < 60) {
    return locale === 'ru' ? `${minutes} мин` : `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (remMinutes === 0) {
    return locale === 'ru' ? `${hours} ч` : `${hours} hr`;
  }
  return locale === 'ru' ? `${hours} ч ${remMinutes} мин` : `${hours} hr ${remMinutes} min`;
}

export function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function resolveDayLabel(
  date: Date,
  now: Date,
  locale: string,
  t: (key: string) => string,
): string {
  if (isSameCalendarDay(date, now)) return t('chat.today');
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (isSameCalendarDay(date, yesterday)) return t('chat.yesterday');
  const day = String(date.getDate()).padStart(2, '0');
  if (locale === 'ru') {
    return `${day} ${RU_MONTHS_GENITIVE[date.getMonth()]} ${date.getFullYear()}`;
  }
  return `${EN_MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

const DICTS: Record<Locale, Dictionary> = { ru, en };

const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
const DAY_MONTH_OPTS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

export function useDateFormat() {
  const locale = useLocaleStore((s) => s.locale);
  return useMemo(
    () => ({
      formatTime: (date: Date) => date.toLocaleTimeString(locale, TIME_OPTS),
      formatDayMonth: (date: Date) => date.toLocaleDateString(locale, DAY_MONTH_OPTS),
      formatFullDate: (date: Date) => {
        const dict = DICTS[locale];
        const t = (key: string) =>
          key === 'chat.today' ? dict.chat.today : dict.chat.yesterday;
        return resolveDayLabel(date, new Date(), locale, t);
      },
    }),
    [locale],
  );
}

type TpFunc = (key: TKey, count: number, vars?: TVars) => string;

/**
 * "только что" / "5 мин назад" / "сегодня в 14:30" / "вчера в 09:15" /
 * "04 сентября 2026 в 10:00" — first matching rule wins, in this order.
 */
export function formatLastSeen(date: Date, now: Date, locale: Locale, t: TFunc, tp: TpFunc): string {
  const diffMinutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  const time = date.toLocaleTimeString(locale, TIME_OPTS);

  if (diffMinutes < 1) return t('server.lastSeenJustNow');
  if (diffMinutes < 60) return tp('server.lastSeenMinutesAgo', diffMinutes, { count: diffMinutes });
  if (isSameCalendarDay(date, now)) return t('server.lastSeenTodayAt', { time });

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (isSameCalendarDay(date, yesterday)) return t('server.lastSeenYesterdayAt', { time });

  const day = String(date.getDate()).padStart(2, '0');
  const dateStr =
    locale === 'ru'
      ? `${day} ${RU_MONTHS_GENITIVE[date.getMonth()]} ${date.getFullYear()}`
      : `${EN_MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  return t('server.lastSeenOnDateAt', { date: dateStr, time });
}
