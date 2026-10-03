import type { MemberWithUser, Reaction, Sticker } from '@/types';

/** Добивка быстрых реакций, когда «недавних» меньше шести. */
export const DEFAULT_QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
export const QUICK_REACTIONS_COUNT = 6;

export const stickerReactionKey = (stickerId: string) => `sticker:${stickerId}`;

export function hasReacted(r: Reaction, userId: string | undefined): boolean {
  return !!userId && (r.user_ids ?? []).includes(userId);
}

/** Оптимистичное изменение снимка. Не мутирует вход; повтор — без изменений. */
export function applyReaction(
  list: Reaction[] | undefined,
  key: string,
  userId: string,
  add: boolean,
  sticker?: Sticker,
): Reaction[] {
  const current = list ?? [];
  const idx = current.findIndex((r) => r.key === key);
  if (add) {
    if (idx === -1) {
      const fresh: Reaction = sticker
        ? { key, sticker, count: 1, user_ids: [userId] }
        : { key, emoji: key, count: 1, user_ids: [userId] };
      return [...current, fresh];
    }
    const r = current[idx];
    if (hasReacted(r, userId)) return current;
    const next = { ...r, count: r.count + 1, user_ids: [...(r.user_ids ?? []), userId] };
    return current.map((x, i) => (i === idx ? next : x));
  }
  if (idx === -1 || !hasReacted(current[idx], userId)) return current;
  const r = current[idx];
  const next = { ...r, count: r.count - 1, user_ids: (r.user_ids ?? []).filter((id) => id !== userId) };
  return next.count <= 0 ? current.filter((_, i) => i !== idx) : current.map((x, i) => (i === idx ? next : x));
}

/** Шесть быстрых реакций: недавние, затем дефолты, без повторов. */
export function quickReactions(recent: string[]): string[] {
  return [...new Set([...recent, ...DEFAULT_QUICK_REACTIONS])].slice(0, QUICK_REACTIONS_COUNT);
}

/** Имена для тултипа: известные участники до limit, остальное — в «ещё N». */
export function reactorNames(r: Reaction, members: MemberWithUser[], limit = 3): { names: string[]; rest: number } {
  const byId = new Map(members.map((m) => [m.user_id, m.username]));
  const names = (r.user_ids ?? [])
    .map((id) => byId.get(id))
    .filter((n): n is string => !!n)
    .slice(0, limit);
  return { names, rest: Math.max(0, r.count - names.length) };
}
