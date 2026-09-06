# Unified Expression Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `EmojiPicker` and `StickerPicker` with one tabbed `ExpressionPicker` — Emoji / Stickers / a disabled GIF placeholder — each opening on a frequency-ranked "frequently used" section persisted in `localStorage`.

**Architecture:** A shell component owns the popover chrome, the top mode tabs and the single `useDismissOnOutside` subscription; `EmojiPanel` and `StickerPanel` are dumb bodies that render a continuous sectioned scroll plus the bottom anchor bar for their mode. Ranking lives in a plain zustand store with pure, separately-exported selectors, so the only logic worth testing is testable without React.

**Tech Stack:** React 19, TypeScript, Zustand 5, Vitest + `@testing-library/react` (jsdom per-file), plain per-component CSS, `lucide-react`.

**Spec:** `docs/superpowers/specs/2026-09-05-unified-expression-picker-design.md` — read it before Task 1. The plan argues from it and does not restate its reasoning.

## Global Constraints

Every task's requirements implicitly include all of these.

- **Every `npm` / `npx` / `node` command runs from `client/`.** There is no root `package.json`; stylelint dies from the repo root with an ENOENT stack that looks like lint output.
- **Gates, all from `client/`:** `npx tsc --noEmit` → exit 0 and **zero bytes**. `npx stylelint "src/**/*.css"` → exit 0 and **zero bytes**. `npm run check:i18n` → «непереведённых строк не найдено.» `npm test` → **exactly 3 failures, all in `api.network-retry.test.ts`** — that file is RED by design; never "fix" it. The gate is that no other file fails.
- **Never `git add -A` or `git add .`** — `design_handoff_discord_redesign/` and `client/src/assets/images/wolves-sitting.webp` are untracked on purpose and are not in `.gitignore`. Every task's commit step lists explicit paths.
- **Tokens only.** No raw colour outside `tokens.css`. No 12px radius — the scale is `--radius-chip` 6 · `--radius-row` 9 · `--radius-btn` 10 · `--radius-card` 11 · `--radius-tile` 13 · `--radius-composer` 14 · `--radius-modal` 16 · `--radius-bar` 18 · `--radius-pill` 999, and no step may be added.
- **No unrequested `var(--x, fallback)`.** A gratuitous fallback silently exempts that site from the audit rule that keeps the token system closed.
- **Class names** match `^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$`, state is `is-*` / `has-*`, never BEM. Everything this plan adds is namespaced `expression-*`, owned by one file.
- **Icons:** `lucide-react` only, every icon with an explicit `size` and `strokeWidth={1.8}`. No exceptions exist; do not create the first.
- **i18n:** `src/i18n/locales/ru.ts` is the source dictionary (`export type Dictionary = typeof ru`), `en.ts` is typed against it, so **`tsc` is the real gate** — both files change in the same commit, always. Dotted nested keys are supported and type-checked.
- **`z-index: 30` is a deliberate literal** in `ExpressionPicker.css`, against the "always a token" rule, and must carry the comment specified in Task 3. See spec §8. Do not "fix" it to a token.
- **Component tests need `// @vitest-environment jsdom` as the first line of the file** — the global vitest environment is `node` (`vite.config.ts:27`).
- `src/test/setup.ts` stubs `window.localStorage` and **clears it in a global `beforeEach`**, so tests need no manual storage teardown.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/stores/expressionRecentsStore.ts` | **New.** Persisted frequency counts for emoji and per-server stickers, plus `lastTab`. Exports pure ranking selectors and the caps as named constants. |
| `src/stores/__tests__/expressionRecentsStore.test.ts` | **New.** The only substantial unit tests in this feature. |
| `src/utils/emojis.ts` | **Modify.** `label` (baked English) → `labelKey` (i18n key). No display text left in this file. |
| `src/i18n/locales/ru.ts`, `en.ts` | **Modify.** Section titles, mode tab labels, the СКОРО chip, seven category names. |
| `src/components/ExpressionPicker.tsx` | **New.** Popover shell: root element, the single `useDismissOnOutside` subscription, mode tabs, body dispatch. |
| `src/components/ExpressionPicker.css` | **New.** One stylesheet for the shell and both panels. |
| `src/components/EmojiPanel.tsx` | **New.** Sectioned emoji scroll + its bottom anchors. |
| `src/components/StickerPanel.tsx` | **New.** Sectioned sticker scroll + its bottom anchors + Manage. |
| `src/components/__tests__/ExpressionPicker.test.tsx` | **New.** Tab visibility and dispatch behaviour. |
| `src/components/Composer.tsx` | **Modify.** Two open-flags collapse to one; exclusion set drops to `{picker, attach}`; its 28-line comment is rewritten. |
| `src/components/MessageRow.tsx` | **Modify.** Editor renders `ExpressionPicker` with `tabs={['emoji']}`; blur guard follows the rename. |
| `src/components/FormattingToolbar.tsx` | **Modify.** `emojiOpen`/`onEmojiToggle` → `pickerOpen`/`onPickerToggle`. |
| `src/styles/base.css` | **Modify.** One line: `::-webkit-scrollbar` gains a `height`. |
| **Deleted** | `EmojiPicker.tsx`, `EmojiPicker.css`, `StickerPicker.tsx`, `StickerPicker.css` |

Task order keeps the app working at every commit: the store and i18n land first with no UI consumer, the editor migrates before the composer, and the old components are deleted only once nothing imports them.

---

## Task 1: Recents store

**Files:**
- Create: `client/src/stores/expressionRecentsStore.ts`
- Test: `client/src/stores/__tests__/expressionRecentsStore.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ExpressionTab = 'emoji' | 'stickers' | 'gif'`
  - `interface RecentEntry { count: number; lastUsed: number }`
  - `interface RecentsState { v: 1; emoji: Record<string, RecentEntry>; stickers: Record<string, Record<string, RecentEntry>>; lastTab: ExpressionTab }`
  - `topEmoji(state: RecentsState, limit: number): string[]`
  - `topStickers(state: RecentsState, serverId: string, limit: number): string[]`
  - `useExpressionRecentsStore` with `recordEmoji(emoji: string): void`, `recordSticker(serverId: string, stickerId: string): void`, `setLastTab(tab: ExpressionTab): void`
  - Constants `MAX_ENTRIES_PER_BUCKET = 64`, `MAX_SERVER_BUCKETS = 20`, `FREQUENT_EMOJI_LIMIT = 8`, `FREQUENT_STICKER_LIMIT = 6`

Model this file on `src/stores/unreadStore.ts` — plain zustand, `load()` called once in the `create()` argument (so it runs at module import), manual `JSON` through `try`/`catch`, store authoritative at runtime.

- [ ] **Step 1: Write the failing test**

Create `client/src/stores/__tests__/expressionRecentsStore.test.ts`:

```ts
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
});

describe('recordSticker', () => {
  it('keys by server', () => {
    useExpressionRecentsStore.getState().recordSticker('s1', 'st-a');
    expect(useExpressionRecentsStore.getState().stickers.s1['st-a'].count).toBe(1);
    expect(useExpressionRecentsStore.getState().stickers.s2).toBeUndefined();
  });

  it('evicts the least-recently-touched server past MAX_SERVER_BUCKETS', () => {
    for (let i = 0; i < MAX_SERVER_BUCKETS; i++) {
      useExpressionRecentsStore.setState((s) => ({
        stickers: { ...s.stickers, [`srv${i}`]: { x: { count: 1, lastUsed: 1000 + i } } },
      }));
    }
    useExpressionRecentsStore.getState().recordSticker('srv-new', 'st-a');
    const ids = Object.keys(useExpressionRecentsStore.getState().stickers);
    expect(ids).toHaveLength(MAX_SERVER_BUCKETS);
    expect(ids).toContain('srv-new');
    expect(ids).not.toContain('srv0'); // самый старый lastUsed
  });
});

describe('setLastTab', () => {
  it('stores and persists the tab', () => {
    useExpressionRecentsStore.getState().setLastTab('stickers');
    expect(useExpressionRecentsStore.getState().lastTab).toBe('stickers');
    expect(JSON.parse(window.localStorage.getItem(KEY)!).lastTab).toBe('stickers');
  });

  it('never persists gif — it is a disabled placeholder', () => {
    useExpressionRecentsStore.getState().setLastTab('gif');
    expect(useExpressionRecentsStore.getState().lastTab).toBe('emoji');
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

From `client/`:

```bash
npx vitest run src/stores/__tests__/expressionRecentsStore.test.ts
```

Expected: FAIL — `Failed to resolve import "../expressionRecentsStore"`.

- [ ] **Step 3: Write the implementation**

Create `client/src/stores/expressionRecentsStore.ts`:

```ts
import { create } from 'zustand';

export type ExpressionTab = 'emoji' | 'stickers' | 'gif';

export interface RecentEntry {
  count: number;
  lastUsed: number;
}

export interface RecentsState {
  v: 1;
  /** Ключ — сам символ эмодзи. Глобально, вне серверов. */
  emoji: Record<string, RecentEntry>;
  /** serverId → stickerId → запись. Стикеры живут внутри сервера. */
  stickers: Record<string, Record<string, RecentEntry>>;
  lastTab: ExpressionTab;
}

const STORAGE_KEY = 'vycord.expressionRecents';

export const MAX_ENTRIES_PER_BUCKET = 64;
export const MAX_SERVER_BUCKETS = 20;
/** Ровно одна строка сетки 8×N. */
export const FREQUENT_EMOJI_LIMIT = 8;
/** Две строки сетки 3×N. */
export const FREQUENT_STICKER_LIMIT = 6;

const EMPTY: RecentsState = { v: 1, emoji: {}, stickers: {}, lastTab: 'emoji' };

function isEntry(x: unknown): x is RecentEntry {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof (x as RecentEntry).count === 'number' &&
    typeof (x as RecentEntry).lastUsed === 'number'
  );
}

/** Отбрасывает мусор, но сохраняет корректных соседей: одна битая запись не
    должна стоить пользователю всей истории. */
function sanitizeBucket(raw: unknown): Record<string, RecentEntry> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, RecentEntry> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isEntry(value)) out[key] = { count: value.count, lastUsed: value.lastUsed };
  }
  return out;
}

function load(): RecentsState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY;
    const p = parsed as Partial<RecentsState>;
    // Незнакомая версия — начинаем с нуля, а не пытаемся мигрировать вслепую.
    if (p.v !== 1) return EMPTY;
    const stickers: RecentsState['stickers'] = {};
    if (p.stickers && typeof p.stickers === 'object') {
      for (const [serverId, bucket] of Object.entries(p.stickers)) {
        stickers[serverId] = sanitizeBucket(bucket);
      }
    }
    return {
      v: 1,
      emoji: sanitizeBucket(p.emoji),
      stickers,
      lastTab: p.lastTab === 'stickers' ? 'stickers' : 'emoji',
    };
  } catch {
    return EMPTY;
  }
}

function persist(next: RecentsState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* стор — источник правды в рантайме; квота или приватный режим не должны
       мешать отправить сообщение */
  }
}

/** count ↓, затем lastUsed ↓, затем ключ — последний разряд только ради
    детерминированного порядка в тестах. */
function rank(bucket: Record<string, RecentEntry>, limit: number): string[] {
  return Object.keys(bucket)
    .sort(
      (a, b) =>
        bucket[b].count - bucket[a].count ||
        bucket[b].lastUsed - bucket[a].lastUsed ||
        (a < b ? -1 : 1),
    )
    .slice(0, limit);
}

export function topEmoji(state: RecentsState, limit: number): string[] {
  return rank(state.emoji, limit);
}

export function topStickers(state: RecentsState, serverId: string, limit: number): string[] {
  return rank(state.stickers[serverId] ?? {}, limit);
}

function pruneBucket(bucket: Record<string, RecentEntry>): Record<string, RecentEntry> {
  const keys = Object.keys(bucket);
  if (keys.length <= MAX_ENTRIES_PER_BUCKET) return bucket;
  const kept = rank(bucket, MAX_ENTRIES_PER_BUCKET);
  return Object.fromEntries(kept.map((k) => [k, bucket[k]]));
}

function bump(
  bucket: Record<string, RecentEntry>,
  key: string,
  now: number,
): Record<string, RecentEntry> {
  const prev = bucket[key];
  return pruneBucket({ ...bucket, [key]: { count: (prev?.count ?? 0) + 1, lastUsed: now } });
}

/** Свежесть сервера — максимальный lastUsed внутри его корзины. */
function bucketRecency(bucket: Record<string, RecentEntry>): number {
  return Object.values(bucket).reduce((acc, e) => Math.max(acc, e.lastUsed), 0);
}

function pruneServerBuckets(stickers: RecentsState['stickers']): RecentsState['stickers'] {
  const ids = Object.keys(stickers);
  if (ids.length <= MAX_SERVER_BUCKETS) return stickers;
  const kept = ids
    .sort((a, b) => bucketRecency(stickers[b]) - bucketRecency(stickers[a]) || (a < b ? -1 : 1))
    .slice(0, MAX_SERVER_BUCKETS);
  return Object.fromEntries(kept.map((id) => [id, stickers[id]]));
}

interface ExpressionRecentsStore extends RecentsState {
  recordEmoji: (emoji: string) => void;
  recordSticker: (serverId: string, stickerId: string) => void;
  setLastTab: (tab: ExpressionTab) => void;
}

/** Отбрасывает экшены — в localStorage уезжают только данные. */
function snapshot(s: RecentsState): RecentsState {
  return { v: 1, emoji: s.emoji, stickers: s.stickers, lastTab: s.lastTab };
}

export const useExpressionRecentsStore = create<ExpressionRecentsStore>((set) => ({
  ...load(),

  // Пишем на КАЖДЫЙ выбор, в отличие от unreadStore с его редким markRead.
  // Это осознанно: synchronous stringify + setItem по ≤64 записям стоит
  // микросекунды, а отложенная запись потеряла бы историю при закрытии окна.
  recordEmoji: (emoji) =>
    set((s) => {
      const next = { ...snapshot(s), emoji: bump(s.emoji, emoji, Date.now()) };
      persist(next);
      return next;
    }),

  recordSticker: (serverId, stickerId) =>
    set((s) => {
      const now = Date.now();
      const stickers = pruneServerBuckets({
        ...s.stickers,
        [serverId]: bump(s.stickers[serverId] ?? {}, stickerId, now),
      });
      const next = { ...snapshot(s), stickers };
      persist(next);
      return next;
    }),

  // 'gif' — выключенная заглушка: если её запомнить, пикер откроется на
  // вкладке, которую нельзя выбрать.
  setLastTab: (tab) =>
    set((s) => {
      const next = { ...snapshot(s), lastTab: tab === 'stickers' ? 'stickers' : 'emoji' };
      persist(next);
      return next;
    }),
}));
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/stores/__tests__/expressionRecentsStore.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Run the type gate**

```bash
npx tsc --noEmit
```

Expected: exit 0, zero bytes of output.

- [ ] **Step 6: Commit**

```bash
git add client/src/stores/expressionRecentsStore.ts \
        client/src/stores/__tests__/expressionRecentsStore.test.ts
git commit -m "feat: add expression recents store"
```

---

## Task 2: i18n keys and `emojis.ts` category keys

**Files:**
- Modify: `client/src/utils/emojis.ts`
- Modify: `client/src/i18n/locales/ru.ts` (inside the flat `chat:` block)
- Modify: `client/src/i18n/locales/en.ts` (same positions)
- Test: `client/src/utils/__tests__/emojis.test.ts` (add one case)

**Interfaces:**
- Consumes: nothing.
- Produces: `EmojiCategory` gains `labelKey: TKey` and loses `label`. New keys `chat.frequentlyUsed`, `chat.gif`, `chat.comingSoon`, and `chat.emojiCategory.{smileys,gestures,animals,food,activities,objects,symbols}`.

`utils/emojis.ts` currently carries baked English display text (`'😀 Smileys'`) that nothing renders. The sectioned headers make it visible, so display text leaves this file entirely.

- [ ] **Step 1: Add the Russian keys**

In `client/src/i18n/locales/ru.ts`, inside the `chat: {` block, next to the existing `emoji`/`stickers` entries:

```ts
    frequentlyUsed: 'Часто используемые',
    gif: 'GIF',
    comingSoon: 'скоро',
    emojiCategory: {
      smileys: 'Люди',
      gestures: 'Жесты',
      animals: 'Животные',
      food: 'Еда',
      activities: 'Активности',
      objects: 'Предметы',
      symbols: 'Символы',
    },
```

- [ ] **Step 2: Add the English keys**

In `client/src/i18n/locales/en.ts`, at the matching position in its `chat:` block:

```ts
    frequentlyUsed: 'Frequently used',
    gif: 'GIF',
    comingSoon: 'soon',
    emojiCategory: {
      smileys: 'People',
      gestures: 'Gestures',
      animals: 'Animals',
      food: 'Food',
      activities: 'Activities',
      objects: 'Objects',
      symbols: 'Symbols',
    },
```

- [ ] **Step 3: Swap `label` for `labelKey`**

Replace the whole of `client/src/utils/emojis.ts`:

```ts
import type { TKey } from '@/i18n';

export interface EmojiCategory {
  id: string;
  /** Ключ словаря, а не текст: заголовки секций видны пользователю. */
  labelKey: TKey;
  emojis: string[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  { id: 'smileys', labelKey: 'chat.emojiCategory.smileys', emojis: ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😜', '🤪', '🤔', '😎', '🤩', '🥳', '😭', '😡', '😱', '🥺', '😴', '🤯', '🥱'] },
  { id: 'gestures', labelKey: 'chat.emojiCategory.gestures', emojis: ['👋', '🤚', '🖐️', '✋', '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '👏', '🙌', '🙏', '🤝', '💪', '👈', '👉', '☝️', '👇'] },
  { id: 'animals', labelKey: 'chat.emojiCategory.animals', emojis: ['🐶', '🐱', '🦊', '🐻', '🐼', '🐨', '🦁', '🐯', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦄', '🐝', '🐢', '🐙', '🦋'] },
  { id: 'food', labelKey: 'chat.emojiCategory.food', emojis: ['🍎', '🍌', '🍓', '🍉', '🍇', '🍕', '🍔', '🍟', '🌭', '🍿', '🍩', '🍪', '🎂', '🍰', '🍫', '☕', '🍺', '🥤', '🍦', '🥟'] },
  { id: 'activities', labelKey: 'chat.emojiCategory.activities', emojis: ['⚽', '🏀', '🏈', '⚾', '🎾', '🎳', '🏆', '🥇', '🎮', '🎲', '🎯', '🎸', '🎹', '🎤', '🎧', '🎬', '✈️', '🚗', '🚀', '🏠'] },
  { id: 'objects', labelKey: 'chat.emojiCategory.objects', emojis: ['💡', '🔑', '📱', '💻', '🖥️', '⌚', '📷', '🎥', '📝', '📚', '✏️', '🖊️', '📌', '📎', '🔒', '🔨', '🎁', '💊', '🧲', '🛒'] },
  { id: 'symbols', labelKey: 'chat.emojiCategory.symbols', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '💯', '❗', '❓', '❗', '⭐', '✨', '🔥', '💤', '💢', '💥', '✅', '❌'] },
];
```

- [ ] **Step 4: Add the test case**

Append inside the existing `describe('EMOJI_CATEGORIES', ...)` block in `client/src/utils/__tests__/emojis.test.ts`:

```ts
  it('every category carries a distinct labelKey under chat.emojiCategory', () => {
    const keys = EMOJI_CATEGORIES.map((c) => c.labelKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k.startsWith('chat.emojiCategory.')).toBe(true);
  });
```

- [ ] **Step 5: Run the tests and both text gates**

```bash
npx vitest run src/utils/__tests__/emojis.test.ts
npx tsc --noEmit
npm run check:i18n
```

Expected: vitest PASS; `tsc` exit 0 with zero bytes (this is the real gate that `en.ts` matches `ru.ts`, and that every `labelKey` is a valid `TKey`); `check:i18n` prints «непереведённых строк не найдено.».

`EmojiPicker.tsx` reads `c.label` only for a `title` attribute; if `tsc` flags it, leave the error for now — Task 3 replaces that component's only consumer, and Task 5 deletes it. If you prefer a green intermediate commit, change `title={c.label}` to `title={t(c.labelKey)}` in `EmojiPicker.tsx` as part of this task.

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/emojis.ts \
        client/src/utils/__tests__/emojis.test.ts \
        client/src/i18n/locales/ru.ts \
        client/src/i18n/locales/en.ts \
        client/src/components/EmojiPicker.tsx
git commit -m "feat: move emoji category labels into the dictionary"
```

---

## Task 3: `ExpressionPicker` shell + `EmojiPanel`, wired into the message editor

**Files:**
- Create: `client/src/components/ExpressionPicker.tsx`
- Create: `client/src/components/ExpressionPicker.css`
- Create: `client/src/components/EmojiPanel.tsx`
- Create: `client/src/components/__tests__/ExpressionPicker.test.tsx`
- Modify: `client/src/components/FormattingToolbar.tsx`
- Modify: `client/src/components/MessageRow.tsx:252-318`
- Modify: `client/src/components/Composer.tsx` (prop rename at the `FormattingToolbar` call site only)

**Interfaces:**
- Consumes: `useExpressionRecentsStore`, `topEmoji`, `FREQUENT_EMOJI_LIMIT`, `ExpressionTab` (Task 1); `EMOJI_CATEGORIES` with `labelKey` (Task 2).
- Produces:
  - `ExpressionPicker` with the props block below.
  - `EmojiPanel` with `{ onSelect: (emoji: string) => void }`.
  - `FormattingToolbar` props renamed: `emojiOpen` → `pickerOpen`, `onEmojiToggle` → `onPickerToggle`.

At the end of this task the message editor uses the new picker and the composer still uses the old two. Both work.

- [ ] **Step 1: Write `EmojiPanel`**

Create `client/src/components/EmojiPanel.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { EMOJI_CATEGORIES } from '@/utils/emojis';
import {
  useExpressionRecentsStore,
  topEmoji,
  FREQUENT_EMOJI_LIMIT,
} from '@/stores/expressionRecentsStore';
import { useT } from '@/i18n';

interface EmojiPanelProps {
  onSelect: (emoji: string) => void;
}

const FREQUENT_ID = 'frequent';

export function EmojiPanel({ onSelect }: EmojiPanelProps) {
  const t = useT();
  const recordEmoji = useExpressionRecentsStore((s) => s.recordEmoji);
  // Снимок на момент открытия: если пересортировывать «частые» прямо во время
  // выбора, плитка уезжает из-под курсора.
  const [frequent] = useState(() =>
    topEmoji(useExpressionRecentsStore.getState(), FREQUENT_EMOJI_LIMIT),
  );

  const sections = [
    // Пустую секцию не показываем вовсе — новый пользователь должен видеть
    // «Люди» первыми, а не осиротевший заголовок.
    ...(frequent.length ? [{ id: FREQUENT_ID, title: t('chat.frequentlyUsed'), emojis: frequent }] : []),
    ...EMOJI_CATEGORIES.map((c) => ({ id: c.id, title: t(c.labelKey), emojis: c.emojis })),
  ];

  const bodyRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const [active, setActive] = useState(sections[0].id);
  // Программный скролл проходит через промежуточные секции, и каждая по пути
  // дёргает observer — подсветка мигает. Гасим её на время анимации.
  const suppressUntil = useRef(0);

  useEffect(() => {
    const root = bodyRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < suppressUntil.current) return;
        const hit = entries.find((e) => e.isIntersecting);
        if (hit) setActive(hit.target.id.replace('expression-section-', ''));
      },
      { root, rootMargin: '0px 0px -85% 0px', threshold: 0 },
    );
    sectionRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections.length]);

  const jumpTo = (id: string) => {
    suppressUntil.current = Date.now() + 250;
    setActive(id);
    sectionRefs.current.get(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const choose = (emoji: string) => {
    recordEmoji(emoji);
    onSelect(emoji);
  };

  return (
    <>
      <div className="expression-picker-body" ref={bodyRef}>
        {sections.map((s) => (
          <section
            key={s.id}
            id={`expression-section-${s.id}`}
            className="expression-section"
            ref={(el) => {
              if (el) sectionRefs.current.set(s.id, el);
              else sectionRefs.current.delete(s.id);
            }}
          >
            <h3 className="expression-section-title">{s.title}</h3>
            <div className="expression-emoji-grid">
              {s.emojis.map((e, i) => (
                <button
                  key={`${s.id}-${i}`}
                  type="button"
                  className="expression-emoji-cell"
                  onClick={() => choose(e)}
                  aria-label={t('chat.insertEmoji')}
                >
                  {e}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="expression-picker-anchors">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`expression-picker-anchor${s.id === active ? ' is-active' : ''}`}
            onClick={() => jumpTo(s.id)}
            title={s.title}
            aria-label={s.title}
          >
            {s.id === FREQUENT_ID ? <Clock size={15} strokeWidth={1.8} /> : s.emojis[0]}
          </button>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Write the `ExpressionPicker` shell**

Create `client/src/components/ExpressionPicker.tsx`. `StickerPanel` does not exist yet — the `stickers` branch is added in Task 4, and the import below is deliberately absent until then.

```tsx
import { useState } from 'react';
import { useDismissOnOutside } from '@/hooks/useDismissOnOutside';
import { EmojiPanel } from '@/components/EmojiPanel';
import { useExpressionRecentsStore, type ExpressionTab } from '@/stores/expressionRecentsStore';
import { useT } from '@/i18n';
import './ExpressionPicker.css';

export interface ExpressionPickerProps {
  /** Редактор сообщения передаёт ['emoji'], композер — все три. */
  tabs: ExpressionTab[];
  /** Какая кнопка открыла пикер. Иначе — запомненная вкладка, иначе tabs[0]. */
  initialTab?: ExpressionTab;
  onClose: () => void;
  onSelectEmoji: (emoji: string) => void;
}

export function ExpressionPicker({ tabs, initialTab, onClose, onSelectEmoji }: ExpressionPickerProps) {
  const t = useT();
  // Единственная подписка на весь пикер. Панели — «глупые» тела: хук держит
  // capture-listener на document и должен жить ровно столько, сколько
  // смонтирована поверхность (см. useDismissOnOutside.ts).
  const ref = useDismissOnOutside<HTMLDivElement>(onClose);
  const lastTab = useExpressionRecentsStore((s) => s.lastTab);
  const setLastTab = useExpressionRecentsStore((s) => s.setLastTab);

  const pick = (t2: ExpressionTab | undefined) => (t2 && tabs.includes(t2) ? t2 : undefined);
  const [active, setActive] = useState<ExpressionTab>(
    () => pick(initialTab) ?? pick(lastTab) ?? tabs[0],
  );

  const select = (tab: ExpressionTab) => {
    setActive(tab);
    setLastTab(tab);
  };

  const label: Record<ExpressionTab, string> = {
    emoji: t('chat.emoji'),
    stickers: t('chat.stickers'),
    gif: t('chat.gif'),
  };

  return (
    <div className="expression-picker" role="dialog" ref={ref}>
      {/* Одна вкладка — полоса не нужна: редактор сообщения получает ровно
          сегодняшнюю поверхность плюс секцию «часто используемые». */}
      {tabs.length > 1 && (
        <div className="expression-picker-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              // GIF — заглушка из макета: видима, но недостижима, пока нет панели.
              disabled={tab === 'gif'}
              aria-selected={tab === active}
              className={`expression-picker-tab${tab === active ? ' is-active' : ''}`}
              onClick={() => select(tab)}
            >
              {label[tab]}
              {tab === 'gif' && <span className="expression-picker-chip">{t('chat.comingSoon')}</span>}
            </button>
          ))}
        </div>
      )}
      {active === 'emoji' && <EmojiPanel onSelect={onSelectEmoji} />}
    </div>
  );
}
```

- [ ] **Step 3: Write the stylesheet**

Create `client/src/components/ExpressionPicker.css`:

```css
/* Единый пикер эмодзи/стикеров/GIF. Позиционируется от ближайшего
   `position: relative` предка: `.composer-root` из композера, `.msg-edit`
   из встроенного редактора сообщения. */
.expression-picker {
  position: absolute;
  right: 12px;
  bottom: calc(100% + 8px);

  /* Литерал ОСОЗНАННО, вопреки правилу «z-index — всегда токен».
     `.composer-root` — position: relative с z-index: auto, то есть НЕ создаёт
     контекста наложения: пикер конкурирует прямо в корневом контексте, там же,
     где все `position: fixed` оверлеи. Значит он обязан рисоваться НИЖЕ стека
     оверлеев, а в шкале нет ступени ниже --z-overlay (1000): --z-popover (1100)
     поднял бы пикер над модалками и над --z-menu (1050). Что оверлей реально
     может подняться над открытым пикером — измерено, а не предположено:
     useDismissOnOutside.ts:24-29 фиксирует ⌘K над открытым пикером (хоткей не
     шлёт mousedown, поэтому пикер не закрывается). 30 — то же значение, что
     было у обоих удалённых стилей и у соседних поповеров ChatArea.css:479,511. */
  z-index: 30;
  display: flex;
  flex-direction: column;

  /* Ширина и высота одинаковы на всех вкладках: переключение не должно
     менять размер поповера. */
  width: 324px;
  height: 360px;
  overflow: hidden;
  background: var(--canvas);
  border: 1px solid var(--line);
  border-radius: var(--radius-modal);
  box-shadow: var(--shadow-popover);
  animation: fade-in 0.12s var(--ease-out);
}

.expression-picker-tabs {
  display: flex;
  flex-shrink: 0;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--line);
}

.expression-picker-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
  background: none;
  border: none;
  border-radius: var(--radius-btn);
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.expression-picker-tab:hover:not(:disabled) {
  color: var(--ink);
  background: var(--canvas-2);
}

.expression-picker-tab.is-active {
  color: var(--accent-text);
  background: var(--accent-soft);
}

.expression-picker-tab:disabled {
  color: var(--muted-2);
  cursor: default;
}

.expression-picker-chip {
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  background: var(--canvas-3);
  border-radius: var(--radius-chip);
}

.expression-picker-body {
  flex: 1;
  padding: 0 8px 8px;
  overflow-y: auto;
}

.expression-section-title {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  padding: 8px 2px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted-2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: var(--canvas);
}

.expression-emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
}

.expression-emoji-cell {
  display: flex;

  /* Никакой фиксированной ширины: ячейка следует за своей дорожкой. Именно
     фиксированные 96px внутри repeat(3, 1fr) давали старому .sticker-picker
     горизонтальный скроллбар. */
  width: 100%;
  aspect-ratio: 1;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 18px;
  line-height: 1;
  background: none;
  border: none;
  border-radius: var(--radius-row);
  cursor: pointer;
  transition: background var(--transition);
}

.expression-emoji-cell:hover {
  background: var(--canvas-2);
}

.expression-picker-anchors {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
  padding: 6px 8px;
  overflow-x: auto;
  border-top: 1px solid var(--line);
}

.expression-picker-anchor {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: 16px;
  line-height: 1;
  color: var(--muted);
  background: none;
  border: none;
  border-radius: var(--radius-row);
  cursor: pointer;
  transition: background var(--transition);
}

.expression-picker-anchor:hover {
  background: var(--canvas-2);
}

.expression-picker-anchor.is-active {
  color: var(--accent-text);
  background: var(--accent-soft);
}
```

- [ ] **Step 4: Write the component test**

Create `client/src/components/__tests__/ExpressionPicker.test.tsx`. jsdom implements neither `IntersectionObserver` nor `scrollIntoView`, so both are stubbed — without the stubs the component throws on mount.

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExpressionPicker } from '@/components/ExpressionPicker';
import { useExpressionRecentsStore } from '@/stores/expressionRecentsStore';

beforeEach(() => {
  useExpressionRecentsStore.setState({ v: 1, emoji: {}, stickers: {}, lastTab: 'emoji' });
  // jsdom не реализует ни то, ни другое — без заглушек компонент падает на mount.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});

describe('ExpressionPicker', () => {
  it('renders no tab strip when only one tab is offered', () => {
    render(<ExpressionPicker tabs={['emoji']} onClose={vi.fn()} onSelectEmoji={vi.fn()} />);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('renders a tab strip when several tabs are offered, with GIF disabled', () => {
    render(
      <ExpressionPicker tabs={['emoji', 'stickers', 'gif']} onClose={vi.fn()} onSelectEmoji={vi.fn()} />,
    );
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /GIF/ })).toHaveProperty('disabled', true);
  });

  it('selecting an emoji records it and reports it upward', () => {
    const onSelectEmoji = vi.fn();
    render(<ExpressionPicker tabs={['emoji']} onClose={vi.fn()} onSelectEmoji={onSelectEmoji} />);
    fireEvent.click(screen.getAllByText('😀')[0]);
    expect(onSelectEmoji).toHaveBeenCalledWith('😀');
    expect(useExpressionRecentsStore.getState().emoji['😀'].count).toBe(1);
  });

  it('shows the frequently-used section only when there is history', () => {
    const { unmount } = render(
      <ExpressionPicker tabs={['emoji']} onClose={vi.fn()} onSelectEmoji={vi.fn()} />,
    );
    expect(screen.queryByText(/Часто используемые|Frequently used/)).toBeNull();
    unmount();

    useExpressionRecentsStore.setState({ emoji: { '👍': { count: 3, lastUsed: 1 } } });
    render(<ExpressionPicker tabs={['emoji']} onClose={vi.fn()} onSelectEmoji={vi.fn()} />);
    expect(screen.getByText(/Часто используемые|Frequently used/)).toBeTruthy();
  });
});
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run src/components/__tests__/ExpressionPicker.test.tsx
```

Expected: PASS, 4 cases.

- [ ] **Step 6: Rename the `FormattingToolbar` props**

In `client/src/components/FormattingToolbar.tsx`, rename `onEmojiToggle` → `onPickerToggle` and `emojiOpen` → `pickerOpen` in the interface, the destructured parameter, and the button at line 54. Leave the `preventAndStop` handler and the comment above it **exactly** as they are — the reasoning still holds and is load-bearing.

Update the two call sites so the file compiles:
- `client/src/components/Composer.tsx:320-321` — `onPickerToggle={() => togglePicker('emoji')}` and `pickerOpen={emojiOpen}` (the composer's own state is renamed in Task 5).
- `client/src/components/MessageRow.tsx:301-302` — handled by the next step.

- [ ] **Step 7: Wire the message editor to the new picker**

In `client/src/components/MessageRow.tsx`:

1. Replace the import at line 6: `import { ExpressionPicker } from '@/components/ExpressionPicker';`
2. Line 254: `const [pickerOpen, setPickerOpen] = useState(false);`
3. Line 291 blur guard — this one is load-bearing, it is what stops a click in the picker from discarding the edit:

```tsx
        onBlur={() => { if (!linkOpen && !pickerOpen) onCancelEdit(); }}
```

4. Lines 301-302:

```tsx
        onPickerToggle={() => setPickerOpen((open) => !open)}
        pickerOpen={pickerOpen}
```

5. Lines 305-310:

```tsx
      {pickerOpen && (
        <ExpressionPicker
          tabs={['emoji']}
          onClose={() => setPickerOpen(false)}
          onSelectEmoji={(emoji) => { insertAtCaret(target, emoji); setPickerOpen(false); }}
        />
      )}
```

Also update the doc comment at lines 246-251, which says the editor owns an "emoji picker".

- [ ] **Step 8: Run the gates**

```bash
npx tsc --noEmit
npx stylelint "src/**/*.css"
npm test
```

Expected: `tsc` and `stylelint` both exit 0 with zero bytes. `npm test` fails exactly 3 tests, all in `api.network-retry.test.ts`, and nothing else.

- [ ] **Step 9: Commit**

```bash
git add client/src/components/ExpressionPicker.tsx \
        client/src/components/ExpressionPicker.css \
        client/src/components/EmojiPanel.tsx \
        client/src/components/__tests__/ExpressionPicker.test.tsx \
        client/src/components/FormattingToolbar.tsx \
        client/src/components/MessageRow.tsx \
        client/src/components/Composer.tsx
git commit -m "feat: add ExpressionPicker shell and use it in the message editor"
```

---

## Task 4: `StickerPanel`

**Files:**
- Create: `client/src/components/StickerPanel.tsx`
- Modify: `client/src/components/ExpressionPicker.tsx`
- Modify: `client/src/components/ExpressionPicker.css`
- Modify: `client/src/components/__tests__/ExpressionPicker.test.tsx`

**Interfaces:**
- Consumes: `topStickers`, `FREQUENT_STICKER_LIMIT`, `recordSticker` (Task 1); the shell from Task 3.
- Produces: `ExpressionPickerProps` gains the optional `stickers` block; `StickerPanel` with `{ serverId, items, onSend, onManage? }`.

- [ ] **Step 1: Write `StickerPanel`**

Create `client/src/components/StickerPanel.tsx`:

```tsx
import { useRef, useState } from 'react';
import { Clock, Settings2, Sticker as StickerIcon } from 'lucide-react';
import {
  useExpressionRecentsStore,
  topStickers,
  FREQUENT_STICKER_LIMIT,
} from '@/stores/expressionRecentsStore';
import { resolveUploadUrl } from '@/services/api';
import { useT } from '@/i18n';
import type { Sticker } from '@/types';

export interface StickerPanelProps {
  serverId: string;
  items: Sticker[];
  /** Резолвится в true при успехе; при неудаче панель остаётся открытой. */
  onSend: (s: Sticker) => Promise<boolean>;
  onManage?: () => void;
}

const FREQUENT_ID = 'frequent';
const ALL_ID = 'all';

export function StickerPanel({ serverId, items, onSend, onManage }: StickerPanelProps) {
  const t = useT();
  const recordSticker = useExpressionRecentsStore((s) => s.recordSticker);

  // Снимок на момент открытия, как в EmojiPanel: плитка не должна уезжать
  // из-под курсора. Хранятся id — резолвим их по живому списку и МОЛЧА
  // выбрасываем промахи, иначе удалённый стикер даёт битую картинку.
  const [frequentIds] = useState(() =>
    topStickers(useExpressionRecentsStore.getState(), serverId, FREQUENT_STICKER_LIMIT),
  );
  const byId = new Map(items.map((s) => [s.id, s]));
  const frequent = frequentIds.map((id) => byId.get(id)).filter((s): s is Sticker => !!s);

  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const [active, setActive] = useState(frequent.length ? FREQUENT_ID : ALL_ID);

  const jumpTo = (id: string) => {
    setActive(id);
    sectionRefs.current.get(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const choose = (s: Sticker) => {
    void onSend(s).then((ok) => { if (ok) recordSticker(serverId, s.id); });
  };

  const section = (id: string, title: string, list: Sticker[]) => (
    <section
      key={id}
      className="expression-section"
      ref={(el) => {
        if (el) sectionRefs.current.set(id, el);
        else sectionRefs.current.delete(id);
      }}
    >
      <h3 className="expression-section-title">{title}</h3>
      <div className="expression-sticker-grid">
        {list.map((s) => (
          <button
            key={`${id}-${s.id}`}
            type="button"
            className="expression-sticker-cell"
            onClick={() => choose(s)}
          >
            <img src={resolveUploadUrl(s.image_url)} alt={s.name} />
          </button>
        ))}
      </div>
    </section>
  );

  return (
    <>
      <div className="expression-picker-body">
        {items.length === 0 ? (
          <div className="expression-sticker-empty">{t('chat.noStickers')}</div>
        ) : (
          <>
            {frequent.length > 0 && section(FREQUENT_ID, t('chat.frequentlyUsed'), frequent)}
            {section(ALL_ID, t('chat.stickers'), items)}
          </>
        )}
      </div>
      <div className="expression-picker-anchors">
        {frequent.length > 0 && (
          <button
            type="button"
            className={`expression-picker-anchor${active === FREQUENT_ID ? ' is-active' : ''}`}
            onClick={() => jumpTo(FREQUENT_ID)}
            title={t('chat.frequentlyUsed')}
            aria-label={t('chat.frequentlyUsed')}
          >
            <Clock size={15} strokeWidth={1.8} />
          </button>
        )}
        <button
          type="button"
          className={`expression-picker-anchor${active === ALL_ID ? ' is-active' : ''}`}
          onClick={() => jumpTo(ALL_ID)}
          title={t('chat.stickers')}
          aria-label={t('chat.stickers')}
        >
          <StickerIcon size={15} strokeWidth={1.8} />
        </button>
        {onManage && (
          // Не полноширинный футер, как было у .sticker-picker: в общей полосе
          // высота панели одинакова на всех вкладках.
          <button
            type="button"
            className="expression-picker-anchor expression-picker-manage"
            onClick={onManage}
            title={t('chat.manageStickers')}
            aria-label={t('chat.manageStickers')}
          >
            <Settings2 size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Add the sticker styles**

Append to `client/src/components/ExpressionPicker.css`:

```css
.expression-sticker-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.expression-sticker-cell {
  display: flex;

  /* Как и .expression-emoji-cell — ширина от дорожки, а не фиксированная. */
  width: 100%;
  aspect-ratio: 1;
  align-items: center;
  justify-content: center;
  padding: 4px;
  background: none;
  border: none;
  border-radius: var(--radius-btn);
  cursor: pointer;
  transition: background var(--transition);
}

.expression-sticker-cell:hover {
  background: var(--canvas-2);
}

.expression-sticker-cell img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: var(--radius-row);
}

.expression-sticker-empty {
  padding: 20px 10px;
  font-size: 13px;
  color: var(--muted-2);
  text-align: center;
}

.expression-picker-manage {
  margin-left: auto;
  color: var(--accent-text);
}
```

- [ ] **Step 3: Add the `stickers` branch to the shell**

In `client/src/components/ExpressionPicker.tsx`, add the import, extend the props, and render the panel:

```tsx
import { StickerPanel, type StickerPanelProps } from '@/components/StickerPanel';
```

```tsx
  /** Отсутствует ⇒ вкладку «Стикеры» отрисовать нельзя. */
  stickers?: StickerPanelProps;
```

```tsx
      {active === 'stickers' && stickers && <StickerPanel {...stickers} />}
```

- [ ] **Step 4: Add the sticker test cases**

Append to `client/src/components/__tests__/ExpressionPicker.test.tsx`:

```tsx
import type { Sticker } from '@/types';

const sticker = (id: string): Sticker => ({
  id, server_id: 's1', name: id, image_url: `/uploads/${id}.png`,
  created_by: 'u1', created_at: '2026-09-05T00:00:00Z',
});

describe('ExpressionPicker: stickers', () => {
  const openStickers = (items: Sticker[], onSend = vi.fn().mockResolvedValue(true)) => {
    render(
      <ExpressionPicker
        tabs={['emoji', 'stickers', 'gif']}
        initialTab="stickers"
        onClose={vi.fn()}
        onSelectEmoji={vi.fn()}
        stickers={{ serverId: 's1', items, onSend }}
      />,
    );
    return onSend;
  };

  it('records a sticker only after a successful send', async () => {
    const onSend = openStickers([sticker('st-a')]);
    fireEvent.click(screen.getByAltText('st-a'));
    await vi.waitFor(() =>
      expect(useExpressionRecentsStore.getState().stickers.s1['st-a'].count).toBe(1),
    );
    expect(onSend).toHaveBeenCalled();
  });

  it('does not record a sticker when the send fails', async () => {
    const onSend = openStickers([sticker('st-a')], vi.fn().mockResolvedValue(false));
    fireEvent.click(screen.getByAltText('st-a'));
    // Ждём именно вызов onSend, а не «состояние пустое» — последнее верно
    // сразу и waitFor вернулся бы, не дав .then() в choose() ни одного тика.
    await vi.waitFor(() => expect(onSend).toHaveBeenCalled());
    await Promise.resolve();
    expect(useExpressionRecentsStore.getState().stickers.s1).toBeUndefined();
    // Панель осталась открытой: неудачная отправка ничего не закрывает.
    expect(screen.getByAltText('st-a')).toBeTruthy();
  });

  it('drops frequently-used ids that are no longer in the inventory', () => {
    useExpressionRecentsStore.setState({
      stickers: { s1: { 'st-gone': { count: 9, lastUsed: 2 }, 'st-a': { count: 1, lastUsed: 1 } } },
    });
    openStickers([sticker('st-a')]);
    // st-a попадает и в «частые», и в «все»; st-gone не встречается нигде.
    expect(screen.getAllByAltText('st-a')).toHaveLength(2);
    expect(screen.queryByAltText('st-gone')).toBeNull();
  });

  it('shows the empty state for a server with no stickers', () => {
    openStickers([]);
    expect(screen.getByText(/пока нет стикеров|No stickers/)).toBeTruthy();
  });
});
```

- [ ] **Step 5: Run the tests and the gates**

```bash
npx vitest run src/components/__tests__/ExpressionPicker.test.tsx
npx tsc --noEmit
npx stylelint "src/**/*.css"
```

Expected: vitest PASS (8 cases total); both gates exit 0 with zero bytes.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/StickerPanel.tsx \
        client/src/components/ExpressionPicker.tsx \
        client/src/components/ExpressionPicker.css \
        client/src/components/__tests__/ExpressionPicker.test.tsx
git commit -m "feat: add sticker panel to the expression picker"
```

---

## Task 5: Wire the composer, delete the old pickers

**Files:**
- Modify: `client/src/components/Composer.tsx:104-142, 312-411`
- Delete: `client/src/components/EmojiPicker.tsx`, `client/src/components/EmojiPicker.css`, `client/src/components/StickerPicker.tsx`, `client/src/components/StickerPicker.css`

**Interfaces:**
- Consumes: `ExpressionPicker` (Tasks 3–4).
- Produces: nothing downstream.

- [ ] **Step 1: Replace the imports**

In `client/src/components/Composer.tsx`, replace lines 16-17 with:

```tsx
import { ExpressionPicker } from '@/components/ExpressionPicker';
```

- [ ] **Step 2: Collapse the open state**

Replace lines 104-105 with:

```tsx
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<ExpressionTab>('emoji');
```

Add `ExpressionTab` to the type import from the store:

```tsx
import type { ExpressionTab } from '@/stores/expressionRecentsStore';
```

- [ ] **Step 3: Rewrite the exclusion state machine and its comment**

Replace the comment block and function at lines 110-142. The reasoning below is not new — it is the existing comment, updated for the two-way set, with its citation of `tools/probe-picker-exclusion.js` dropped (that file lives only under `.superpowers/sdd/` scratch and has never been in the repo).

```tsx
  /**
   * The two popover surfaces are MUTUALLY EXCLUSIVE: opening one closes the
   * other. Every toggle below goes through this, never through a bare setter.
   *
   * The set used to be three — emoji, sticker, attach. Emoji and sticker are
   * now one ExpressionPicker with tabs, so it is two.
   *
   * Exclusion has to live here because the toggles opt out of the only
   * mechanism that would otherwise provide it. `useDismissOnOutside` dismisses
   * on a DOCUMENT bubble-phase `mousedown`, and each toggle carries
   * `onMouseDown={(e) => e.stopPropagation()}` so it can close its own picker.
   * React's SyntheticEvent.stopPropagation() calls
   * nativeEvent.stopPropagation() at the root container, so that press never
   * reaches the document — and the document listener is also what would have
   * dismissed the OTHER surface. The opt-out and cross-dismissal cannot both
   * come from that one listener; the opt-out is the one worth keeping (it is
   * what makes a toggle able to close its own picker), so exclusion is
   * explicit state here.
   *
   * `fmtOpen` and `linkOpen` are deliberately OUTSIDE the set. The formatting
   * toolbar is a persistent strip rather than an occluding popover, and it is
   * what renders the second picker toggle — closing it on open would detach
   * that button mid-interaction. `linkOpen` is a dialog with its own scrim.
   */
  const togglePicker = (which: 'picker' | 'attach') => {
    setPickerOpen((v) => (which === 'picker' ? !v : false));
    setAttachOpen((v) => (which === 'attach' ? !v : false));
  };

  /**
   * Emoji and sticker share one surface, so their buttons differ only in which
   * tab they land on. Pressing the button for the tab already showing closes
   * the picker; pressing the other SWITCHES tab rather than closing — the
   * behaviour that motivates merging the two surfaces in the first place.
   */
  const openPickerOn = (tab: ExpressionTab) => {
    if (pickerOpen && pickerTab !== tab) {
      setPickerTab(tab);
      return;
    }
    setPickerTab(tab);
    togglePicker('picker');
  };
```

- [ ] **Step 4: Update the toggle buttons**

At line 355, the sticker button: `className={\`composer-icon-btn${pickerOpen && pickerTab === 'stickers' ? ' is-active' : ''}\`}` and `onClick={() => openPickerOn('stickers')}`.

At line 371, the emoji button: `className={\`composer-icon-btn${pickerOpen && pickerTab === 'emoji' ? ' is-active' : ''}\`}` and `onClick={() => openPickerOn('emoji')}`.

Both keep `onMouseDown={(e) => e.stopPropagation()}` and the comments explaining it — unchanged.

At line 383, `AttachmentButton`: `onToggle={() => togglePicker('attach')}` — unchanged.

At lines 320-321, `FormattingToolbar`: `onPickerToggle={() => openPickerOn('emoji')}` and `pickerOpen={pickerOpen && pickerTab === 'emoji'}`.

- [ ] **Step 5: Replace both rendered pickers with one**

Replace lines 398-411 with:

```tsx
      {pickerOpen && (
        <ExpressionPicker
          tabs={['emoji', 'stickers', 'gif']}
          initialTab={pickerTab}
          onClose={() => setPickerOpen(false)}
          onSelectEmoji={(emoji) => { insertAtCaret(target, emoji); setPickerOpen(false); }}
          stickers={{
            serverId: channel.server_id,
            items: serverStickers,
            onSend: async (sticker) => {
              const ok = await onSendSticker(sticker);
              if (ok) setPickerOpen(false);
              return ok;
            },
            onManage: canManageStickers
              ? () => { setPickerOpen(false); onOpenStickerManager(); }
              : undefined,
          }}
        />
      )}
```

Note `onSend` returns the boolean through to `StickerPanel`, which needs it to decide whether to record the sticker. Closing on success stays a composer concern.

Also update the component doc comment at lines 82-86, which says "emoji/sticker chrome".

- [ ] **Step 6: Delete the old components**

```bash
git rm client/src/components/EmojiPicker.tsx \
       client/src/components/EmojiPicker.css \
       client/src/components/StickerPicker.tsx \
       client/src/components/StickerPicker.css
```

- [ ] **Step 7: Verify nothing still imports them**

```bash
rg -n 'EmojiPicker|StickerPicker|emoji-picker|sticker-picker|emoji-cell|emoji-tab' src tools
```

Expected: only prose matches in `hooks/useDismissOnOutside.ts`, `components/AttachmentButton.tsx`, `components/ChatArea.css` and `styles/primitives.css` — all comments, all fixed in Task 6. **Zero** `import` lines and zero CSS selectors. If a real reference appears, fix it before committing.

- [ ] **Step 8: Run the gates**

```bash
npx tsc --noEmit
npx stylelint "src/**/*.css"
npm test
```

Expected: `tsc` and `stylelint` exit 0 with zero bytes; `npm test` fails exactly 3, all in `api.network-retry.test.ts`.

- [ ] **Step 9: Commit**

`git rm` in Step 6 already staged the four deletions — re-listing them here
would fail with `pathspec did not match any files`, because they no longer
exist in the index or the worktree. Only the modified file needs adding.

```bash
git add client/src/components/Composer.tsx
git commit -m "feat: use the unified expression picker in the composer"
```

---

## Task 6: Comment sweep, scrollbar guard, final verification

**Files:**
- Modify: `client/src/styles/base.css:36-38`
- Modify: `client/src/styles/primitives.css:356-377`
- Modify: `client/src/hooks/useDismissOnOutside.ts:14-16, 47-50`
- Modify: `client/src/components/AttachmentButton.tsx:32`
- Modify: `client/src/components/ChatArea.css:464`

**Interfaces:** none — this task changes comments and one CSS declaration.

Deleting two components invalidates prose that names them by file and line. None of it is caught by any gate.

- [ ] **Step 1: Give the horizontal scrollbar a height**

In `client/src/styles/base.css`, replace the rule at lines 36-38:

```css
/* `width` управляет только вертикальным скроллбаром; у горизонтального
   толщину задаёт `height`, и без неё он падал на браузерные ~15px — из-за
   чего случайное горизонтальное переполнение выглядело особенно грубо.
   Это страховка от класса ошибки, а не лечение конкретного случая:
   переполнение у .sticker-picker убрано в самой сетке (ExpressionPicker.css). */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
```

- [ ] **Step 2: Re-derive the `fade-in` consumer list**

```bash
rg -n 'fade-in|scale-in|modal-in' src/
```

In `client/src/styles/primitives.css`, update the comment block so the `fade-in` line names `ExpressionPicker.css` at its real line number instead of `EmojiPicker.css:18, StickerPicker.css:17`. Leave the `scale-in` and `modal-in` lines alone unless the command above shows they changed. The comment states the list was re-derived rather than carried forward — keep that true.

- [ ] **Step 3: Update `useDismissOnOutside`'s prose**

In `client/src/hooks/useDismissOnOutside.ts`:
- Lines 14-16 list the toggles carrying the `stopPropagation` opt-out. It is now the composer's emoji and sticker buttons (both opening `ExpressionPicker`), `FormattingToolbar`'s picker button at both render sites, and `AttachmentButton`'s.
- Lines 47-50 name the call sites rendering outside any `.modal-overlay` — the claim is what makes the `isBlockingOverlayOpen()` deferral sound and still holds. Rewrite to `ExpressionPicker` (Composer + MessageRow's editor) and `AttachmentButton`'s `AttachPicker`.

- [ ] **Step 4: Update the two remaining references**

- `client/src/components/AttachmentButton.tsx:32` — "the hook's only other two call sites (EmojiPicker, StickerPicker)" becomes one call site, `ExpressionPicker`.
- `client/src/components/ChatArea.css:464` — "siblings (EmojiPicker.css / StickerPicker.css)" becomes `ExpressionPicker.css`.

- [ ] **Step 5: Run all four gates**

```bash
npx tsc --noEmit
npx stylelint "src/**/*.css"
npm run check:i18n
npm test
```

Expected: `tsc` exit 0 and zero bytes · `stylelint` exit 0 and zero bytes · `check:i18n` prints «непереведённых строк не найдено.» · `npm test` fails **exactly 3**, all in `api.network-retry.test.ts`. Any other failing file is yours.

- [ ] **Step 6: Commit**

```bash
git add client/src/styles/base.css \
        client/src/styles/primitives.css \
        client/src/hooks/useDismissOnOutside.ts \
        client/src/components/AttachmentButton.tsx \
        client/src/components/ChatArea.css
git commit -m "chore: update picker references after the merge"
```

- [ ] **Step 7: Hand over the click-list**

Gates verify only what they were pointed at, and there is no capture run in this plan by preference. Start the dev server:

```bash
npm run dev:vite
```

**Not `npm run dev`** — that also launches Electron under `concurrently -k`, so an Electron that fails to start takes vite down with it.

Report these to the requester rather than checking them off silently:

1. Both themes, and at a narrow width.
2. Each toggle opens the picker on its own tab; pressing it again closes it; pressing the other switches tab **without** closing.
3. `FormattingToolbar`'s emoji button opens the picker on the emoji tab.
4. Outside click dismisses; Escape dismisses.
5. Escape **during a message edit** dismisses only the picker and does not cancel the edit.
6. ⌘K over an open picker opens the palette; one Escape closes the palette and leaves the picker. While the palette is up, the picker paints **under** it.
7. Scroll and drag-scroll the emoji body **during a message edit** — the edit survives.
8. Bottom anchors scroll to their section; the active anchor tracks scrolling without strobing.
9. **No horizontal scrollbar on any tab, at any content length.**
10. Sticker send failure keeps the panel open.
11. A server with no stickers shows the empty state.
12. Using an emoji or sticker moves it into frequently-used and it survives a reload; a deleted sticker leaves frequently-used silently.
13. Panel height does not change when switching tabs.

---

## Notes for the reviewer

- **Item 2 in the click-list is the one invented behaviour.** Switch-instead-of-close was proposed rather than requested, and approved. Task 5 Step 3 lands it as a discrete `openPickerOn` helper so it can be reverted to a plain `togglePicker('picker')` without unpicking anything else.
- **The `IntersectionObserver` highlight is the only fiddly part.** If it misbehaves, the accepted fallback (spec §5) is highlight-on-click only: delete the `useEffect` in `EmojiPanel` and keep `jumpTo`'s `setActive`. Scrolling is the requirement; the live highlight is a refinement.
- **`z-index: 30` is deliberate**, with its reasoning in the stylesheet. Do not "fix" it to a token — spec §8 explains why every available token is wrong here.
