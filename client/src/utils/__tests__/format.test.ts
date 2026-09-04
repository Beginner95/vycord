import { describe, expect, it } from 'vitest';
import { isSameCalendarDay, resolveDayLabel, RU_MONTHS_GENITIVE, EN_MONTHS, formatCallDuration, formatLastSeen } from '@/i18n/format';

const ruT = (key: string) => (key === 'chat.today' ? 'Сегодня' : 'Вчера');
const enT = (key: string) => (key === 'chat.today' ? 'Today' : 'Yesterday');

describe('isSameCalendarDay', () => {
  it('сравнивает по локальному календарному дню', () => {
    expect(isSameCalendarDay(new Date(2026, 1, 1, 0, 0, 0), new Date(2026, 1, 1, 23, 59, 59))).toBe(true);
    expect(isSameCalendarDay(new Date(2026, 1, 1), new Date(2026, 1, 2))).toBe(false);
  });
});

describe('resolveDayLabel', () => {
  const NOW = new Date(2026, 1, 5, 12, 0, 0); // 5 февраля 2026

  it('сегодня → «Сегодня»', () => {
    expect(resolveDayLabel(new Date(2026, 1, 5, 8, 30), NOW, 'ru', ruT)).toBe('Сегодня');
  });
  it('вчера → «Вчера»', () => {
    expect(resolveDayLabel(new Date(2026, 1, 4, 20, 0), NOW, 'ru', ruT)).toBe('Вчера');
  });
  it('вчера через границу месяца → «Вчера»', () => {
    const now = new Date(2026, 2, 1, 12, 0);
    expect(resolveDayLabel(new Date(2026, 1, 28), now, 'ru', ruT)).toBe('Вчера');
  });
  it('вчера через границу года → «Вчера»', () => {
    const now = new Date(2026, 0, 1);
    expect(resolveDayLabel(new Date(2025, 11, 31), now, 'ru', ruT)).toBe('Вчера');
  });
  it('ru: «01 февраля 2026» c ведущим нулём и склоняемым месяцем, без «г.»', () => {
    expect(resolveDayLabel(new Date(2026, 1, 1), NOW, 'ru', ruT)).toBe('01 февраля 2026');
  });
  it('ru: однозначный день с нулём «03 января 2026»', () => {
    expect(resolveDayLabel(new Date(2026, 0, 3), NOW, 'ru', ruT)).toBe('03 января 2026');
  });
  it('en: «February 1, 2026»', () => {
    expect(resolveDayLabel(new Date(2026, 1, 1), NOW, 'en', enT)).toBe('February 1, 2026');
  });
  it('en: Today / Yesterday', () => {
    expect(resolveDayLabel(new Date(2026, 1, 5), NOW, 'en', enT)).toBe('Today');
    expect(resolveDayLabel(new Date(2026, 1, 4), NOW, 'en', enT)).toBe('Yesterday');
  });
});

describe('month dictionaries', () => {
  it('RU_MONTHS_GENITIVE: 12 месяцев, февраль → «февраля»', () => {
    expect(RU_MONTHS_GENITIVE).toHaveLength(12);
    expect(RU_MONTHS_GENITIVE[1]).toBe('февраля');
  });
  it('EN_MONTHS: 12 названий, февраль → «February»', () => {
    expect(EN_MONTHS).toHaveLength(12);
    expect(EN_MONTHS[1]).toBe('February');
  });
});

describe('formatCallDuration', () => {
  it('ru boundaries: 0 / 59s / 60s / 59m / 60m / 1h20m', () => {
    expect(formatCallDuration(0, 'ru')).toBe('0 сек');
    expect(formatCallDuration(59, 'ru')).toBe('59 сек');
    expect(formatCallDuration(60, 'ru')).toBe('1 мин');
    expect(formatCallDuration(3599, 'ru')).toBe('59 мин');
    expect(formatCallDuration(3600, 'ru')).toBe('1 ч');
    expect(formatCallDuration(4800, 'ru')).toBe('1 ч 20 мин');
  });
  it('en boundaries: same shape', () => {
    expect(formatCallDuration(0, 'en')).toBe('0 sec');
    expect(formatCallDuration(59, 'en')).toBe('59 sec');
    expect(formatCallDuration(60, 'en')).toBe('1 min');
    expect(formatCallDuration(3599, 'en')).toBe('59 min');
    expect(formatCallDuration(3600, 'en')).toBe('1 hr');
    expect(formatCallDuration(4800, 'en')).toBe('1 hr 20 min');
  });
  it('clamps negative input to 0', () => {
    expect(formatCallDuration(-5, 'ru')).toBe('0 сек');
  });
});

const ruLastSeenDict: Record<string, string> = {
  'server.lastSeenJustNow': 'только что',
  'server.lastSeenTodayAt': 'сегодня в {{time}}',
  'server.lastSeenYesterdayAt': 'вчера в {{time}}',
  'server.lastSeenOnDateAt': '{{date}} в {{time}}',
};
const enLastSeenDict: Record<string, string> = {
  'server.lastSeenJustNow': 'just now',
  'server.lastSeenTodayAt': 'today at {{time}}',
  'server.lastSeenYesterdayAt': 'yesterday at {{time}}',
  'server.lastSeenOnDateAt': '{{date}} at {{time}}',
};

function fakeInterpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

function fakeLastSeenT(dict: Record<string, string>) {
  return (key: string, vars?: Record<string, string | number>) => fakeInterpolate(dict[key] ?? key, vars);
}

function fakeLastSeenTp(locale: 'ru' | 'en') {
  return (key: string, count: number, vars?: Record<string, string | number>) => {
    if (key !== 'server.lastSeenMinutesAgo') return key;
    const rule = new Intl.PluralRules(locale).select(count);
    const forms: Record<string, string> =
      locale === 'ru'
        ? { one: '{{count}} минуту назад', few: '{{count}} минуты назад', many: '{{count}} минут назад', other: '{{count}} минуты назад' }
        : { one: '{{count}} minute ago', other: '{{count}} minutes ago' };
    const template = forms[rule] ?? forms.other;
    return fakeInterpolate(template, { ...vars, count });
  };
}

describe('formatLastSeen', () => {
  const NOW = new Date(2026, 8, 4, 12, 0, 0); // 4 сентября 2026, 12:00

  it('< 1 мин → «только что»', () => {
    const date = new Date(NOW.getTime() - 30 * 1000);
    expect(formatLastSeen(date, NOW, 'ru', fakeLastSeenT(ruLastSeenDict), fakeLastSeenTp('ru'))).toBe('только что');
  });

  it('1 мин назад — форма «one»', () => {
    const date = new Date(NOW.getTime() - 1 * 60 * 1000);
    expect(formatLastSeen(date, NOW, 'ru', fakeLastSeenT(ruLastSeenDict), fakeLastSeenTp('ru'))).toBe('1 минуту назад');
  });

  it('5 мин назад — форма «many»', () => {
    const date = new Date(NOW.getTime() - 5 * 60 * 1000);
    expect(formatLastSeen(date, NOW, 'ru', fakeLastSeenT(ruLastSeenDict), fakeLastSeenTp('ru'))).toBe('5 минут назад');
  });

  it('2 часа назад, тот же календарный день → «сегодня в HH:MM», не «N ч назад»', () => {
    const date = new Date(2026, 8, 4, 10, 0, 0);
    expect(formatLastSeen(date, NOW, 'ru', fakeLastSeenT(ruLastSeenDict), fakeLastSeenTp('ru'))).toBe('сегодня в 10:00');
  });

  it('вчера → «вчера в HH:MM»', () => {
    const date = new Date(2026, 8, 3, 21, 15, 0);
    expect(formatLastSeen(date, NOW, 'ru', fakeLastSeenT(ruLastSeenDict), fakeLastSeenTp('ru'))).toBe('вчера в 21:15');
  });

  it('> 7 дней → полная дата', () => {
    const date = new Date(2026, 7, 20, 9, 0, 0);
    expect(formatLastSeen(date, NOW, 'ru', fakeLastSeenT(ruLastSeenDict), fakeLastSeenTp('ru'))).toBe('20 августа 2026 в 09:00');
  });

  it('en: minutes-ago plural', () => {
    const date = new Date(NOW.getTime() - 2 * 60 * 1000);
    expect(formatLastSeen(date, NOW, 'en', fakeLastSeenT(enLastSeenDict), fakeLastSeenTp('en'))).toBe('2 minutes ago');
  });
});
