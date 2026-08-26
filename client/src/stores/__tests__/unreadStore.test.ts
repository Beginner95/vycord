import { describe, it, expect, beforeEach } from 'vitest';
import { useUnreadStore, firstUnreadId } from '../unreadStore';
import type { Message } from '@/types';

const m = (id: string, ts: string): Message => ({
  id, channel_id: 'c', user_id: 'u', content: 'x', created_at: ts, updated_at: ts,
});

beforeEach(() => {
  window.localStorage.removeItem('vycord.lastRead');
  useUnreadStore.setState({ lastRead: {} });
});

describe('unreadStore', () => {
  it('markRead stores and persists the mark', () => {
    useUnreadStore.getState().markRead('c1', 'm9', '2026-08-25T12:00:00Z');
    expect(useUnreadStore.getState().lastRead.c1).toEqual({ messageId: 'm9', ts: '2026-08-25T12:00:00Z' });
    expect(JSON.parse(window.localStorage.getItem('vycord.lastRead')!)).toHaveProperty('c1');
  });
  it('firstUnreadId: no mark → null (first visit shows no divider)', () => {
    expect(firstUnreadId(undefined, [m('a', '2026-08-25T10:00:00Z')])).toBeNull();
  });
  it('firstUnreadId: returns first message after the mark', () => {
    const mark = { messageId: 'a', ts: '2026-08-25T10:00:00Z' };
    const msgs = [m('a', '2026-08-25T10:00:00Z'), m('b', '2026-08-25T10:01:00Z'), m('c', '2026-08-25T10:02:00Z')];
    expect(firstUnreadId(mark, msgs)).toBe('b');
  });
  it('firstUnreadId: everything read → null', () => {
    const mark = { messageId: 'b', ts: '2026-08-25T10:01:00Z' };
    const msgs = [m('a', '2026-08-25T10:00:00Z'), m('b', '2026-08-25T10:01:00Z')];
    expect(firstUnreadId(mark, msgs)).toBeNull();
  });
  it('firstUnreadId: empty list → null', () => {
    expect(firstUnreadId({ messageId: 'a', ts: '2026-08-25T10:00:00Z' }, [])).toBeNull();
  });
  it('markRead survives a corrupt localStorage payload', () => {
    window.localStorage.setItem('vycord.lastRead', '{not json');
    useUnreadStore.getState().markRead('c1', 'm1', '2026-08-25T12:00:00Z');
    expect(useUnreadStore.getState().lastRead.c1.messageId).toBe('m1');
  });
});
