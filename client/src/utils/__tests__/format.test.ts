import { describe, expect, it } from 'vitest';
import { isSameCalendarDay, resolveDayLabel, RU_MONTHS_GENITIVE, EN_MONTHS } from '@/i18n/format';

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