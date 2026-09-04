import { describe, it, expect } from 'vitest';
import { lastSeenLabel, chunkUserIds } from '@/components/UserList';

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

describe('chunkUserIds', () => {
  it('пустой список → пустой массив чанков', () => {
    expect(chunkUserIds([], 200)).toEqual([]);
  });

  it('список короче размера чанка → один чанк', () => {
    const ids = ['a', 'b', 'c'];
    expect(chunkUserIds(ids, 200)).toEqual([['a', 'b', 'c']]);
  });

  it('список ровно размера чанка → один чанк', () => {
    const ids = Array.from({ length: 200 }, (_, i) => String(i));
    expect(chunkUserIds(ids, 200)).toEqual([ids]);
  });

  it('список чуть больше размера чанка → два чанка, второй с одним элементом', () => {
    const ids = Array.from({ length: 201 }, (_, i) => String(i));
    const chunks = chunkUserIds(ids, 200);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(200);
    expect(chunks[1]).toEqual(['200']);
  });

  it('несколько полных чанков сохраняют порядок', () => {
    const ids = Array.from({ length: 450 }, (_, i) => String(i));
    const chunks = chunkUserIds(ids, 200);
    expect(chunks.map((c) => c.length)).toEqual([200, 200, 50]);
    expect(chunks.flat()).toEqual(ids);
  });

  it('size <= 0 не зацикливается и возвращает всё одним чанком', () => {
    expect(chunkUserIds(['a', 'b'], 0)).toEqual([['a', 'b']]);
  });
});
