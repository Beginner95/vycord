import { describe, it, expect } from 'vitest';
import {
  rankByName, buildPalette, moveSelection, selectedIndexOf, shouldShowEmptyState,
  CAP_CHANNELS, CAP_MESSAGES, PALETTE_MIN_QUERY,
  type PaletteActionDef, type PaletteMessage,
} from './paletteFilter';
import type { Channel } from '@/types';

const ch = (id: string, name: string, position = 0): Channel => ({
  id, name, position, server_id: 's',
  created_at: '2026-08-25T12:00:00Z', updated_at: '2026-08-25T12:00:00Z',
});

const action = (id: string, label: string): PaletteActionDef =>
  ({ id, label, run: () => {} });

const msg = (id: string, content: string): PaletteMessage =>
  ({ id, username: 'a', content, created_at: '2026-08-25T12:00:00Z' });

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

  it('keeps source order inside the same rank', () => {
    // Все три имени намеренно попадают в один и тот же бакет (префикс на 'ген'),
    // так что тест проверяет именно сохранение порядка внутри бакета — приоритет
    // префикса над подстрокой уже проверен отдельным тестом выше. Запрос 'р' из
    // прежней фикстуры клал по одному элементу в каждый бакет и не проверял tie
    // вообще: prefix.reverse() перед конкатенацией всё равно прошёл бы.
    const tied = [ch('x', 'генерал-один'), ch('y', 'генерал-два'), ch('z', 'генерал-три')];
    expect(rankByName(tied, 'ген', (c) => c.name, 6).map((c) => c.id)).toEqual(['x', 'y', 'z']);
  });

  it('returns nothing when nothing matches', () =>
    expect(rankByName(items, 'zzz', (c) => c.name, 6)).toEqual([]));

  it('never returns more than the cap', () => {
    // Непустой запрос и фикстура строго больше cap: пустой запрос уходит в
    // ранний return `items.slice(0, cap)` и не проверяет `.slice(0, cap)` на
    // общем пути ранжирования (решение 15 — cap не должен быть тихим по построению).
    const many = Array.from({ length: CAP_CHANNELS + 2 }, (_, i) => ch(String(i), `генерал-${i}`));
    const result = rankByName(many, 'ген', (c) => c.name, CAP_CHANNELS);
    expect(result).toHaveLength(CAP_CHANNELS);
    expect(result.map((c) => c.id)).toEqual(['0', '1', '2', '3', '4', '5']);
  });
});

// Module-level so the selectedIndexOf / shouldShowEmptyState suites below can
// drive REAL models through buildPalette instead of hand-written row literals.
const baseInput = {
  channels: [ch('1', 'общий'), ch('2', 'генерал')],
  actions: [action('a', 'Создать канал')],
  messages: [] as PaletteMessage[],
  messagesTotal: 0,
  hasChannel: true,
  messagesLoading: false,
  messagesError: null as string | null,
};

describe('buildPalette', () => {
  const base = baseInput;

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

  it('caps the messages group at CAP_MESSAGES even when more are supplied', () => {
    // Отдельный, независимый слайс от `rankByName` — CAP_MESSAGES применяется
    // внутри buildPalette к messages.slice(...), а не через rankByName.
    const supplied = Array.from({ length: CAP_MESSAGES + 2 }, (_, i) => ({
      id: `m${i}`, username: 'a', content: 'ген', created_at: '2026-08-25T12:00:00Z',
    }));
    const model = buildPalette({ ...base, query: 'ген', messages: supplied, messagesTotal: supplied.length });
    const messages = model.groups.find((g) => g.key === 'messages');
    const messageRows = messages?.rows.filter((r) => r.kind === 'message') ?? [];
    expect(messageRows).toHaveLength(CAP_MESSAGES);
    expect(messageRows.map((r) => r.id)).toEqual(
      supplied.slice(0, CAP_MESSAGES).map((m) => `message-${m.id}`),
    );
  });

  it('gives each group a `from` index that indexes into the flat row list', () => {
    const model = buildPalette({
      ...base, query: 'ген',
      messagesLoading: true,
      // Тот же приём, что и в тесте порядка групп выше: без совпадающего
      // действия выжила бы только группа channels и `from` всегда был бы 0 —
      // тест не смог бы отличить правильную арифметику от жёстко зашитого нуля.
      actions: [action('a', 'Войти в голосовой «генерал»')],
    });
    expect(model.groups.length).toBeGreaterThanOrEqual(2);
    // `from` indexes the first SELECTABLE row (paletteFilter.ts:41-51), and status
    // rows never enter `rows` at all — so the universal this test used to assert,
    // «model.rows[group.from + i] === group.rows[i]» over EVERY row, is not one the
    // module satisfies. It passed only because no fixture here built a
    // status-bearing group; the `messagesLoading: true` above builds one, and
    // against the unnarrowed assertion this test FAILS (measured, M6 T12:
    // messages.from pointed at the following group's first action row).
    //
    // Narrowed rather than "fixed" in the module: making the old universal true
    // would mean putting status rows into `rows`, which is precisely what makes a
    // row SELECTABLE — Enter would activate «Ищем…». That is a behaviour change,
    // not a test fix.
    for (const group of model.groups) {
      group.rows
        .filter((row) => row.kind !== 'status')
        .forEach((row, i) => expect(model.rows[group.from + i]).toBe(row));
    }
  });

  it('never mixes status and selectable rows inside one group', () => {
    // THE invariant `from + i` actually rests on, and nothing guarded it before.
    // CommandPalette.tsx:374 derives a row's selection index as `group.from + i`
    // where `i` is the group-LOCAL index — it counts status rows too. That is only
    // correct while no group holds both kinds; a mixed group would silently point
    // every row after the status line at the wrong target. The module's own
    // docblock states the assumption, so it is asserted here rather than trusted.
    const fixtures: Array<[string, Partial<Parameters<typeof buildPalette>[0]>]> = [
      ['loading', { messagesLoading: true }],
      ['error', { messagesError: 'Нет доступа' }],
      ['results', { messages: [msg('m1', 'генерал')], messagesTotal: 1 }],
      ['results + show-all', { messages: [msg('m1', 'генерал')], messagesTotal: 99 }],
      ['no channel', { hasChannel: false, messagesLoading: true }],
    ];
    for (const [label, patch] of fixtures) {
      const model = buildPalette({
        ...base, query: 'ген', actions: [action('a', 'Войти в голосовой «генерал»')], ...patch,
      });
      for (const group of model.groups) {
        const kinds = new Set(group.rows.map((r) => r.kind === 'status'));
        expect(kinds.size, `${label}/${group.key} mixes status and selectable rows`).toBe(1);
      }
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

describe('selectedIndexOf', () => {
  // Строки берём из настоящей модели, а не из литералов: тест должен ломаться,
  // если buildPalette сменит схему id, а не проверять свою же выдумку.
  const model = buildPalette({
    ...baseInput, query: 'ген', actions: [action('a', 'Войти в голосовой «генерал»')],
  });

  it('returns 0 when nothing is selected', () =>
    expect(selectedIndexOf(model.rows, null)).toBe(0));

  it('finds the flat index of the selected id', () => {
    const last = model.rows.length - 1;
    expect(last).toBeGreaterThan(0); // иначе тест не отличил бы находку от нуля
    expect(selectedIndexOf(model.rows, model.rows[last].id)).toBe(last);
  });

  it('falls back to the first row when the id has disappeared', () =>
    expect(selectedIndexOf(model.rows, 'channel-vanished')).toBe(0));

  it('returns 0 on an empty row list', () =>
    expect(selectedIndexOf([], 'channel-1')).toBe(0));
});

describe('shouldShowEmptyState', () => {
  const modelFor = (patch: Partial<Parameters<typeof buildPalette>[0]>) =>
    buildPalette({ ...baseInput, query: 'ген', ...patch });

  it('is false while a resting (empty) query lists everything', () =>
    expect(shouldShowEmptyState(modelFor({ query: '' }), '')).toBe(false));

  it('is false for a whitespace-only query', () =>
    expect(shouldShowEmptyState(modelFor({ query: '   ' }), '   ')).toBe(false));

  it('is true when a real query matched nothing at all', () => {
    const model = modelFor({ query: 'zzzz', channels: [], actions: [] });
    expect(model.groups).toHaveLength(0);
    expect(shouldShowEmptyState(model, 'zzzz')).toBe(true);
  });

  it('is false when the only surviving group holds just a status row', () => {
    // Регрессия, ради которой функция и вынесена: на `rows.length === 0` пустое
    // состояние отрисовалось бы прямо над видимой строкой «Ищем…».
    const model = modelFor({ query: 'zzzz', channels: [], actions: [], messagesLoading: true });
    expect(model.rows).toHaveLength(0);
    expect(model.groups).toHaveLength(1);
    expect(shouldShowEmptyState(model, 'zzzz')).toBe(false);
  });
});
