import { describe, it, expect } from 'vitest';
import { lastSeenLabel } from '@/components/UserList';

const dict: Record<string, string> = {
  'server.lastSeenJustNow': 'только что',
  'server.lastSeenTodayAt': 'сегодня в {{time}}',
};

function t(key: string, vars?: Record<string, string | number>): string {
  const template = dict[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

function tp(): string {
  return 'N мин назад'; // not exercised by these boundary cases
}

describe('lastSeenLabel', () => {
  const NOW = new Date(2026, 8, 4, 12, 0, 0);

  it('null → ничего не показываем', () => {
    expect(lastSeenLabel(null, NOW, 'ru', t, tp)).toBeNull();
  });

  it('undefined → ничего не показываем', () => {
    expect(lastSeenLabel(undefined, NOW, 'ru', t, tp)).toBeNull();
  });

  it('делегирует форматирование formatLastSeen', () => {
    const iso = new Date(2026, 8, 4, 10, 0, 0).toISOString();
    expect(lastSeenLabel(iso, NOW, 'ru', t, tp)).toBe('сегодня в 10:00');
  });
});
