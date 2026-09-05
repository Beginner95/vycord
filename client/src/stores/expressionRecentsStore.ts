import { create } from 'zustand';

// 'gif' is reserved for a future tab — no picker currently renders it (see
// setLastTab below), but the union keeps it so a GIF panel can land later
// without another migration of persisted state. Re-introducing 'gif' into a
// `tabs` array is NOT enough on its own: ExpressionPicker.tsx has no panel
// branch for it, so an enabled 'gif' tab would render a blank body until a
// panel branch is added alongside it.
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

function pruneBucket(
  bucket: Record<string, RecentEntry>,
  limit: number = MAX_ENTRIES_PER_BUCKET,
): Record<string, RecentEntry> {
  const keys = Object.keys(bucket);
  if (keys.length <= limit) return bucket;
  const kept = rank(bucket, limit);
  return Object.fromEntries(kept.map((k) => [k, bucket[k]]));
}

function bump(
  bucket: Record<string, RecentEntry>,
  key: string,
  now: number,
): Record<string, RecentEntry> {
  const prev = bucket[key];
  const entry = { count: (prev?.count ?? 0) + 1, lastUsed: now };
  // The key being written must survive this same call: at a full bucket a
  // brand-new key enters at count: 1 and rank() puts it last (count decides
  // before the lastUsed tiebreak), so pruning it back in with everyone else
  // would silently evict the very write we're making. Prune the OTHER keys
  // down to room-for-one, then add the bumped entry back on top — eviction
  // still takes the lowest count / oldest lastUsed first among every other
  // key, exactly as before.
  const { [key]: _omit, ...others } = bucket;
  const keptOthers = pruneBucket(others, MAX_ENTRIES_PER_BUCKET - 1);
  return { ...keptOthers, [key]: entry };
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
      const next = { ...snapshot(s), lastTab: (tab === 'stickers' ? 'stickers' : 'emoji') as ExpressionTab };
      persist(next);
      return next;
    }),
}));
