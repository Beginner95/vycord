import { useMemo } from 'react';
import { useLocaleStore } from '@/stores/localeStore';

export const RU_MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

export const EN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

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

const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
const DAY_MONTH_OPTS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

export function useDateFormat() {
  const locale = useLocaleStore((s) => s.locale);
  return useMemo(
    () => ({
      formatTime: (date: Date) => date.toLocaleTimeString(locale, TIME_OPTS),
      formatDayMonth: (date: Date) => date.toLocaleDateString(locale, DAY_MONTH_OPTS),
    }),
    [locale],
  );
}
