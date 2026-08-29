import type { Channel } from '@/types';

// Board 2c: query debounce 120ms. The deep panel (MessageSearch) stays at 300ms
// on purpose — it paginates a committed query, the palette previews one.
export const PALETTE_DEBOUNCE_MS = 120;
// Server-enforced: server/internal/delivery/http/handler/message.go:124 rejects
// a query under 2 or over 100 runes with 400 CodeSearchQueryLength.
export const PALETTE_MIN_QUERY = 2;
export const PALETTE_MAX_QUERY = 100;
export const CAP_CHANNELS = 6;
export const CAP_MESSAGES = 5;
// 7 = ровно размер полного реестра действий (решение 16), чтобы пустой запрос
// никогда молча не отбрасывал действие (решение 15).
export const CAP_ACTIONS = 7;

export interface PaletteActionDef {
  id: string;
  label: string;
  run: () => void;
}

export interface PaletteMessage {
  id: string;
  username: string;
  content: string;
  created_at: string;
}

export type PaletteRow =
  | { kind: 'channel'; id: string; channel: Channel }
  | { kind: 'message'; id: string; message: PaletteMessage }
  | { kind: 'action'; id: string; action: PaletteActionDef }
  | { kind: 'show-all'; id: 'show-all' }
  // Status rows render inside a group but are NOT selectable and never enter `rows`.
  | { kind: 'status'; id: string; text: string };

export type PaletteGroupKey = 'channels' | 'messages' | 'actions';

export interface PaletteGroup {
  key: PaletteGroupKey;
  /** Flat index of this group's first SELECTABLE row. */
  from: number;
  rows: PaletteRow[];
}

export interface PaletteModel {
  groups: PaletteGroup[];
  /** Selectable rows in render order; the array index IS the selection index. */
  rows: PaletteRow[];
}

export interface PaletteInput {
  query: string;
  channels: Channel[];
  actions: PaletteActionDef[];
  messages: PaletteMessage[];
  messagesTotal: number;
  hasChannel: boolean;
  messagesLoading: boolean;
  messagesError: string | null;
}

function normalise(value: string): string {
  // Никакой ё/е-нормализации (решение 17): осознанный пробел, а не забытый случай.
  return value.toLocaleLowerCase();
}

export function rankByName<T>(
  items: T[],
  query: string,
  nameOf: (item: T) => string,
  cap: number,
): T[] {
  const q = normalise(query.trim());
  if (!q) return items.slice(0, cap);
  const prefix: T[] = [];
  const substring: T[] = [];
  for (const item of items) {
    const name = normalise(nameOf(item));
    if (name.startsWith(q)) prefix.push(item);
    else if (name.includes(q)) substring.push(item);
  }
  return [...prefix, ...substring].slice(0, cap);
}

export function buildPalette(input: PaletteInput): PaletteModel {
  const {
    query, channels, actions, messages, messagesTotal,
    hasChannel, messagesLoading, messagesError,
  } = input;
  const trimmed = query.trim();

  const channelRows: PaletteRow[] = rankByName(channels, trimmed, (c) => c.name, CAP_CHANNELS)
    .map((channel) => ({ kind: 'channel', id: `channel-${channel.id}`, channel }));

  const actionRows: PaletteRow[] = rankByName(actions, trimmed, (a) => a.label, CAP_ACTIONS)
    .map((action) => ({ kind: 'action', id: `action-${action.id}`, action }));

  const messageRows: PaletteRow[] = [];
  const wantsMessages = hasChannel && trimmed.length >= PALETTE_MIN_QUERY;
  if (wantsMessages) {
    if (messagesError) {
      messageRows.push({ kind: 'status', id: 'messages-error', text: messagesError });
    } else if (messagesLoading) {
      messageRows.push({ kind: 'status', id: 'messages-loading', text: '' });
    } else {
      for (const message of messages.slice(0, CAP_MESSAGES)) {
        messageRows.push({ kind: 'message', id: `message-${message.id}`, message });
      }
      if (messageRows.length > 0 && messagesTotal > messageRows.length) {
        messageRows.push({ kind: 'show-all', id: 'show-all' });
      }
    }
  }

  const groups: PaletteGroup[] = [];
  const rows: PaletteRow[] = [];
  const push = (key: PaletteGroupKey, groupRows: PaletteRow[]) => {
    if (groupRows.length === 0) return;
    groups.push({ key, from: rows.length, rows: groupRows });
    rows.push(...groupRows.filter((row) => row.kind !== 'status'));
  };
  push('channels', channelRows);
  push('messages', messageRows);
  push('actions', actionRows);

  return { groups, rows };
}

export function moveSelection(current: number, delta: number, rowCount: number): number {
  if (rowCount <= 0) return 0;
  return (((current + delta) % rowCount) + rowCount) % rowCount;
}
