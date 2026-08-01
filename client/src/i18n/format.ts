import { useMemo } from 'react';
import { useLocaleStore } from '@/stores/localeStore';

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
