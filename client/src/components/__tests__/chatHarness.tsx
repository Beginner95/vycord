import { vi } from 'vitest';
import type { Channel, MemberWithUser, Server, Sticker, User } from '@/types';
import type { ChatMessage } from '@/stores/messageStore';
import { API_BASE_URL } from '@/services/api';

/** Фиксированное «сейчас»: разделители дней и время строк не зависят от прогона. */
export const fixedNow = new Date('2026-09-20T12:00:00Z');

export const me = { id: 'u1', username: 'anna', email: 'a@x' } as User;
export const otherUser = { user_id: 'u2', username: 'boris', roles: [], joined_at: '' } as MemberWithUser;
export const serverA = { id: 's1', name: 'Wolves', owner_id: 'u1' } as Server;
export const channel: Channel = {
  id: 'c1', server_id: 's1', name: 'general', position: 0, created_at: '', updated_at: '',
};

const base = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 'm', channel_id: 'c1', user_id: 'u2', kind: 'user', content: '',
  created_at: '2026-09-20T09:05:00Z', updated_at: '2026-09-20T09:05:00Z', ...over,
});

/** Чужой текст с форматированием, своё изменённое, своё неотправленное, стикер. */
export function messages(): ChatMessage[] {
  return [
    base({ id: 'm1', content: 'hello **bold** and <@u1>' }),
    base({ id: 'm2', user_id: 'u1', content: 'my text', updated_at: '2026-09-20T09:10:00Z', created_at: '2026-09-20T09:06:00Z' }),
    base({ id: 'pending-1', user_id: 'u1', content: 'failed one', created_at: '2026-09-20T09:07:00Z', updated_at: '2026-09-20T09:07:00Z', deliveryState: 'failed' }),
    base({ id: 'm4', sticker_id: 'st1', content: '', sticker: { id: 'st1', server_id: 's1', name: 'wow', image_url: '/u/wow.png' } as Sticker }),
  ];
}

/** Два стикера для вкладки «Стикеры» пикера. */
export const stickerItems = (): Sticker[] => [
  { id: 'st1', server_id: 's1', name: 'wow', image_url: '/u/wow.png', created_by: 'u1', created_at: '' },
  { id: 'st2', server_id: 's1', name: 'sad', image_url: '/u/sad.png', created_by: 'u1', created_at: '' },
];

/** Заглушки того, чего нет в jsdom и что зовёт чат. */
export function stubBrowser(): void {
  process.env.TZ = 'UTC';
  Element.prototype.scrollIntoView = vi.fn();
  class IO { observe() {} disconnect() {} unobserve() {} takeRecords() { return []; } }
  (globalThis as unknown as { IntersectionObserver: typeof IO }).IntersectionObserver = IO;
  window.matchMedia = vi.fn((q: string) => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

/** React `useId` даёт `:r0:`, `:r1:` … — номер зависит от порядка монтирования
 *  во всём прогоне файла, а не от разметки. Нормализуем номер, структуру не трогаем. */
export const normalizeIds = (html: string): string => html.replace(/:r[0-9a-z]+:/g, ':rN:');

/** Снимки хранят адрес API по умолчанию: `VITE_API_URL` из .env.local разработчика
 *  не должен давать ложный diff. */
const DEFAULT_API_URL = 'http://localhost:8080';
export const normalizeApiUrl = (html: string): string =>
  API_BASE_URL ? html.replaceAll(API_BASE_URL, DEFAULT_API_URL) : html;

/** Единая точка нормализации для всех dom-снимков. */
export const normalizeHtml = (html: string): string => normalizeApiUrl(normalizeIds(html));
