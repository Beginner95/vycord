import { create } from 'zustand';
import type { Message } from '@/types';

export interface LastReadMark { messageId: string; ts: string }

const STORAGE_KEY = 'vycord.lastRead';

function load(): Record<string, LastReadMark> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

interface UnreadState {
  lastRead: Record<string, LastReadMark>;
  markRead: (channelId: string, messageId: string, ts: string) => void;
}

export const useUnreadStore = create<UnreadState>((set) => ({
  lastRead: load(),
  markRead: (channelId, messageId, ts) =>
    set((state) => {
      const next = { ...state.lastRead, [channelId]: { messageId, ts } };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* стор — источник правды в рантайме; квота/приватный режим не роняют чат */
      }
      return { lastRead: next };
    }),
}));

/**
 * Divider anchor, computed once on channel entry (spec §4.4): the first
 * message strictly after the stored mark. No mark (never-visited channel) →
 * no divider.
 */
export function firstUnreadId(mark: LastReadMark | undefined, messages: Message[]): string | null {
  if (!mark || messages.length === 0) return null;
  const found = messages.find((m) => m.id !== mark.messageId && m.created_at > mark.ts);
  return found ? found.id : null;
}
