import { describe, it, expect } from 'vitest';
import {
  rankByName, buildPalette, moveSelection,
  CAP_CHANNELS, PALETTE_MIN_QUERY, type PaletteActionDef,
} from './paletteFilter';
import type { Channel } from '@/types';

const ch = (id: string, name: string, position = 0): Channel => ({
  id, name, position, server_id: 's',
  created_at: '2026-08-25T12:00:00Z', updated_at: '2026-08-25T12:00:00Z',
});

const action = (id: string, label: string): PaletteActionDef =>
  ({ id, label, run: () => {} });

describe('rankByName', () => {
  // Все три имени кириллические намеренно: запрос 'ген' не совпал бы с латинским
  // "general" — toLocaleLowerCase не транслитерирует, и фикстура молча
  // развалила бы тест на ранжирование.
  const items = [ch('1', 'общий'), ch('2', 'генерал'), ch('3', 'разговоры-генерал')];

  it('returns every item, capped, for an empty query', () =>
    expect(rankByName(items, '', (c) => c.name, 2).map((c) => c.id)).toEqual(['1', '2']));

  it('is case-insensitive', () =>
    expect(rankByName(items, 'ОБЩ', (c) => c.name, 6).map((c) => c.id)).toEqual(['1']));

  it('ranks a prefix match above a substring match', () =>
    expect(rankByName(items, 'ген', (c) => c.name, 6).map((c) => c.id)).toEqual(['2', '3']));

  it('keeps source order inside the same rank', () =>
    expect(rankByName(items, 'р', (c) => c.name, 6).map((c) => c.id)).toEqual(['3', '2']));

  it('returns nothing when nothing matches', () =>
    expect(rankByName(items, 'zzz', (c) => c.name, 6)).toEqual([]));

  it('never returns more than the cap', () =>
    expect(rankByName(items, '', (c) => c.name, CAP_CHANNELS).length).toBeLessThanOrEqual(CAP_CHANNELS));
});

describe('buildPalette', () => {
  const base = {
    channels: [ch('1', 'общий'), ch('2', 'генерал')],
    actions: [action('a', 'Создать канал')],
    messages: [],
    messagesTotal: 0,
    hasChannel: true,
    messagesLoading: false,
    messagesError: null,
  };

  it('orders groups channels → messages → actions', () => {
    const model = buildPalette({
      ...base, query: 'ген',
      // Действие должно совпадать с тем же запросом, иначе группа действий
      // пуста и порядок групп проверяется на двух из трёх.
      actions: [action('a', 'Войти в голосовой «генерал»')],
      messages: [{ id: 'm1', username: 'a', content: 'генерал?', created_at: '2026-08-25T12:00:00Z' }],
      messagesTotal: 1,
    });
    expect(model.groups.map((g) => g.key)).toEqual(['channels', 'messages', 'actions']);
  });

  it('omits the messages group below the minimum query length', () => {
    const model = buildPalette({ ...base, query: 'г'.repeat(PALETTE_MIN_QUERY - 1) });
    expect(model.groups.map((g) => g.key)).not.toContain('messages');
  });

  it('omits the messages group when no channel is open', () => {
    const model = buildPalette({ ...base, query: 'ген', hasChannel: false });
    expect(model.groups.map((g) => g.key)).not.toContain('messages');
  });

  it('omits an empty group entirely', () => {
    const model = buildPalette({ ...base, query: 'zzz' });
    expect(model.groups).toEqual([]);
    expect(model.rows).toEqual([]);
  });

  it('adds a show-all row only when the total exceeds what is shown', () => {
    const shown = { id: 'm1', username: 'a', content: 'ген', created_at: '2026-08-25T12:00:00Z' };
    const few = buildPalette({ ...base, query: 'ген', messages: [shown], messagesTotal: 1 });
    const many = buildPalette({ ...base, query: 'ген', messages: [shown], messagesTotal: 9 });
    expect(few.rows.some((r) => r.kind === 'show-all')).toBe(false);
    expect(many.rows.some((r) => r.kind === 'show-all')).toBe(true);
  });

  it('gives each group a `from` index that indexes into the flat row list', () => {
    const model = buildPalette({ ...base, query: 'ген' });
    for (const group of model.groups) {
      group.rows.forEach((row, i) => expect(model.rows[group.from + i]).toBe(row));
    }
  });

  it('renders a loading row instead of results while messages are in flight', () => {
    const model = buildPalette({ ...base, query: 'ген', messagesLoading: true });
    const messages = model.groups.find((g) => g.key === 'messages');
    expect(messages?.rows.map((r) => r.kind)).toEqual(['status']);
    expect(model.rows.some((r) => r.kind === 'status')).toBe(false); // status rows are not selectable
  });

  it('renders an error row when the message search failed', () => {
    const model = buildPalette({ ...base, query: 'ген', messagesError: 'Нет доступа' });
    const messages = model.groups.find((g) => g.key === 'messages');
    expect(messages?.rows[0]).toEqual({ kind: 'status', id: 'messages-error', text: 'Нет доступа' });
  });
});

describe('moveSelection', () => {
  it('wraps past the last row', () => expect(moveSelection(2, 1, 3)).toBe(0));
  it('wraps before the first row', () => expect(moveSelection(0, -1, 3)).toBe(2));
  it('moves normally in between', () => expect(moveSelection(0, 1, 3)).toBe(1));
  it('clamps to 0 on an empty list', () => expect(moveSelection(0, 1, 0)).toBe(0));
});
