import type { Message } from '@/types';
import { isSameCalendarDay } from '@/i18n';

/** Spec §5 M2: grouping window is 5 minutes (was 7 before the redesign). */
export const GROUP_WINDOW_MS = 300_000;

/** A grouped continuation row: same author, same local calendar day, < 5 min apart. */
export function isContinuation(prev: Message | undefined, msg: Message): boolean {
  if (!prev || prev.user_id !== msg.user_id) return false;
  const a = new Date(prev.created_at);
  const b = new Date(msg.created_at);
  if (!isSameCalendarDay(a, b)) return false;
  return b.getTime() - a.getTime() < GROUP_WINDOW_MS;
}
