import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  useExpressionRecentsStore,
  topEmoji,
  topStickers,
  MAX_ENTRIES_PER_BUCKET,
  MAX_SERVER_BUCKETS,
  type RecentsState,
} from '../expressionRecentsStore';

const KEY = 'vycord.expressionRecents';

/** Хелпер: собрать состояние из «ключ → [count, lastUsed]». */
function state(
  emoji: Record<string, [number, number]> = {},
  stickers: Record<string, Record<string, [number, number]>> = {},
): RecentsState {
  const bucket = (b: Record<string, [number, number]>) =>
    Object.fromEntries(Object.entries(b).map(([k, [count, lastUsed]]) => [k, { count, lastUsed }]));
  return {
    v: 1,
    emoji: bucket(emoji),
    stickers: Object.fromEntries(Object.entries(stickers).map(([s, b]) => [s, bucket(b)])),
    lastTab: 'emoji',
  };
}

beforeEach(() => {
  useExpressionRecentsStore.setState({ v: 1, emoji: {}, stickers: {}, lastTab: 'emoji' });
});

describe('ranking selectors', () => {
  it('orders by count descending', () => {
    const s = state({ '🔥': [1, 100], '👍': [5, 100], '😂': [3, 100] });
    expect(topEmoji(s, 8)).toEqual(['👍', '😂', '🔥']);
  });

  it('breaks a count tie with the more recent lastUsed', () => {
    const s = state({ '🔥': [2, 100], '👍': [2, 300], '😂': [2, 200] });
    expect(topEmoji(s, 8)).toEqual(['👍', '😂', '🔥']);
  });

  it('respects the limit', () => {
    const s = state({ a: [3, 1], b: [2, 1], c: [1, 1] });
    expect(topEmoji(s, 2)).toEqual(['a', 'b']);
  });

  it('returns [] for a server with no sticker bucket', () => {
    expect(topStickers(state(), 'srv-unknown', 6)).toEqual([]);
  });

  it('scopes sticker ranking to one server', () => {
    const s = state({}, { s1: { a: [9, 1] }, s2: { b: [1, 1] } });
    expect(topStickers(s, 's1', 6)).toEqual(['a']);
    expect(topStickers(s, 's2', 6)).toEqual(['b']);
  });
});

describe('recordEmoji', () => {
  it('increments the count and persists', () => {
    useExpressionRecentsStore.getState().recordEmoji('👍');
    useExpressionRecentsStore.getState().recordEmoji('👍');
    expect(useExpressionRecentsStore.getState().emoji['👍'].count).toBe(2);
    expect(JSON.parse(window.localStorage.getItem(KEY)!).emoji['👍'].count).toBe(2);
  });

  it('prunes the bucket to MAX_ENTRIES_PER_BUCKET, evicting the lowest count', () => {
    // Одна запись с большим счётчиком и MAX+5 одноразовых: выживает она и
    // MAX-1 из одноразовых, а не «последние добавленные».
    useExpressionRecentsStore.setState({ emoji: { keeper: { count: 99, lastUsed: 1 } } });
    for (let i = 0; i < MAX_ENTRIES_PER_BUCKET + 5; i++) {
      useExpressionRecentsStore.getState().recordEmoji(`e${i}`);
    }
    const bucket = useExpressionRecentsStore.getState().emoji;
    expect(Object.keys(bucket)).toHaveLength(MAX_ENTRIES_PER_BUCKET);
    expect(bucket.keeper).toBeDefined();
  });

  it('does not evict the key it just wrote, even at the cap with every existing entry ahead of it on count', () => {
    // Заполняем корзину до предела записями с count: 2 — новый ключ входит с
    // count: 1 и по rank() всегда проигрывает всем существующим (count решает
    // раньше lastUsed), так что naive prune после bump выбросил бы именно его
    // же — запись стала бы тихим no-op, а строка «часто используемых»
    // замёрзла бы навсегда.
    const full: Record<string, { count: number; lastUsed: number }> = {};
    for (let i = 0; i < MAX_ENTRIES_PER_BUCKET; i++) {
      full[`e${i}`] = { count: 2, lastUsed: i };
    }
    useExpressionRecentsStore.setState({ emoji: full });
    useExpressionRecentsStore.getState().recordEmoji('new');
    const bucket = useExpressionRecentsStore.getState().emoji;
    expect(bucket.new).toBeDefined();
    expect(Object.keys(bucket)).toHaveLength(MAX_ENTRIES_PER_BUCKET);
  });
});

describe('recordSticker', () => {
  it('keys by server', () => {
    useExpressionRecentsStore.getState().recordSticker('s1', 'st-a');
    expect(useExpressionRecentsStore.getState().stickers.s1['st-a'].count).toBe(1);
    expect(useExpressionRecentsStore.getState().stickers.s2).toBeUndefined();
  });

  it('evicts the least-recently-touched server past MAX_SERVER_BUCKETS, not the oldest-inserted', () => {
    // srv0 is inserted FIRST but given the NEWEST lastUsed, so a test that
    // merely checked "srv0 is gone" couldn't tell recency-based eviction from
    // plain FIFO — both would drop srv0. Give it the newest lastUsed instead:
    // it must survive, and the genuinely least-recent bucket (srv1) must be
    // the one dropped.
    for (let i = 0; i < MAX_SERVER_BUCKETS; i++) {
      const lastUsed = i === 0 ? 1000 + MAX_SERVER_BUCKETS : 1000 + i;
      useExpressionRecentsStore.setState((s) => ({
        stickers: { ...s.stickers, [`srv${i}`]: { x: { count: 1, lastUsed } } },
      }));
    }
    useExpressionRecentsStore.getState().recordSticker('srv-new', 'st-a');
    const ids = Object.keys(useExpressionRecentsStore.getState().stickers);
    expect(ids).toHaveLength(MAX_SERVER_BUCKETS);
    expect(ids).toContain('srv-new');
    expect(ids).toContain('srv0'); // самый свежий lastUsed — должен выжить
    expect(ids).not.toContain('srv1'); // теперь самый старый lastUsed
  });
});

describe('setLastTab', () => {
  it('stores and persists the tab', () => {
    useExpressionRecentsStore.getState().setLastTab('stickers');
    expect(useExpressionRecentsStore.getState().lastTab).toBe('stickers');
    expect(JSON.parse(window.localStorage.getItem(KEY)!).lastTab).toBe('stickers');
  });
});

it('a throwing setItem does not break the in-memory store', () => {
  const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
    throw new Error('QuotaExceededError');
  });
  expect(() => useExpressionRecentsStore.getState().recordEmoji('👍')).not.toThrow();
  expect(useExpressionRecentsStore.getState().emoji['👍'].count).toBe(1);
  spy.mockRestore();
});

// load() читает localStorage ровно один раз — в аргументе create(), то есть на
// импорте модуля. Проверить его можно только повторным импортом после того,
// как хранилище уже заполнено. Тот же приём, что в unreadStore.test.ts.
describe('load() at module import', () => {
  const fresh = async (): Promise<RecentsState> => {
    vi.resetModules();
    const mod = await import('../expressionRecentsStore');
    const { recordEmoji, recordSticker, setLastTab, ...rest } = mod.useExpressionRecentsStore.getState();
    return rest as RecentsState;
  };

  afterEach(() => {
    window.localStorage.removeItem(KEY);
    vi.resetModules();
  });

  it('reads a valid payload back', async () => {
    // Положительный контроль: без него пустой результат ниже неотличим от
    // «load() вообще не выполнялся», и все тесты всегда зелёные.
    window.localStorage.setItem(KEY, JSON.stringify(state({ '👍': [3, 42] })));
    expect((await fresh()).emoji).toEqual({ '👍': { count: 3, lastUsed: 42 } });
  });

  it('falls back to empty on corrupt JSON', async () => {
    window.localStorage.setItem(KEY, '{not json');
    expect((await fresh()).emoji).toEqual({});
  });

  it('falls back to empty on valid JSON that is not an object', async () => {
    window.localStorage.setItem(KEY, '42');
    expect((await fresh()).emoji).toEqual({});
  });

  it('falls back to empty on an unknown version', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 2, emoji: { '👍': { count: 3, lastUsed: 1 } } }));
    expect((await fresh()).emoji).toEqual({});
  });

  it('drops malformed entries but keeps well-formed neighbours', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({
      v: 1, lastTab: 'emoji', stickers: {},
      emoji: { good: { count: 2, lastUsed: 5 }, bad: 'nope', alsoBad: { count: 'x' } },
    }));
    expect((await fresh()).emoji).toEqual({ good: { count: 2, lastUsed: 5 } });
  });

  it('coerces a stale lastTab of "gif" (persisted by an earlier build) to emoji', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({
      v: 1, lastTab: 'gif', stickers: {}, emoji: {},
    }));
    expect((await fresh()).lastTab).toBe('emoji');
  });
});
