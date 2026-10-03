import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/services/api', () => ({
  apiService: { getUnread: vi.fn(), markChannelRead: vi.fn(), getReadReceipts: vi.fn() },
}));

import { apiService } from '@/services/api';
import {
  useUnreadStore, firstUnreadId, selectServerUnread, selectChannelUnread, formatUnread, UNREAD_CAP, MARK_READ_WINDOW_MS,
} from '../unreadStore';
import type { ChannelActivityEvent, Message } from '@/types';

const api = vi.mocked(apiService);
const T = (s: number) => `2026-10-03T10:00:${String(s).padStart(2, '0')}Z`;
const m = (id: string, ts: string, kind: Message['kind'] = 'user'): Message => ({
  id, channel_id: 'c1', user_id: 'u2', content: 'x', kind, created_at: ts, updated_at: ts,
});
const act = (over: Partial<ChannelActivityEvent> = {}): ChannelActivityEvent => ({
  op: 'create', server_id: 's1', channel_id: 'c1', message_id: 'mX', created_at: T(30), author_user_id: 'u2', ...over,
});

beforeEach(() => {
  useUnreadStore.getState().reset();
  useUnreadStore.setState({
    channels: { c1: { serverId: 's1', count: 2, cursor: { at: T(10), id: 'm10' } }, c2: { serverId: 's1', count: 3, cursor: { at: T(10), id: null } } },
  });
  api.getUnread.mockReset();
  api.markChannelRead.mockReset();
  api.getReadReceipts.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

describe('unreadStore', () => {
  it('hydrate replaces channels from the server', async () => {
    api.getUnread.mockResolvedValue([{ server_id: 's9', channel_id: 'c9', count: 4, last_read_at: T(1), last_read_message_id: null }]);
    await useUnreadStore.getState().hydrate();
    expect(useUnreadStore.getState().channels).toEqual({ c9: { serverId: 's9', count: 4, cursor: { at: T(1), id: null } } });
  });

  it('hydrate keeps a local cursor that is ahead of the snapshot', async () => {
    api.getUnread.mockResolvedValue([{ server_id: 's1', channel_id: 'c1', count: 7, last_read_at: T(5), last_read_message_id: 'm5' }]);
    await useUnreadStore.getState().hydrate();
    expect(useUnreadStore.getState().channels.c1).toEqual({ serverId: 's1', count: 2, cursor: { at: T(10), id: 'm10' } });
  });

  it('applyActivity create: +1 only for others, only after the cursor', () => {
    const s = useUnreadStore.getState();
    s.applyActivity(act(), 'me');
    expect(useUnreadStore.getState().channels.c1.count).toBe(3);
    s.applyActivity(act({ author_user_id: 'me' }), 'me');
    s.applyActivity(act({ created_at: T(5) }), 'me');
    expect(useUnreadStore.getState().channels.c1.count).toBe(3);
  });

  it('applyActivity counts guest messages (author null)', () => {
    useUnreadStore.getState().applyActivity(act({ author_user_id: null }), 'me');
    expect(useUnreadStore.getState().channels.c1.count).toBe(3);
  });

  it('applyActivity delete: -1, never below zero', () => {
    const s = useUnreadStore.getState();
    s.applyActivity(act({ op: 'delete' }), 'me');
    s.applyActivity(act({ op: 'delete' }), 'me');
    s.applyActivity(act({ op: 'delete' }), 'me');
    expect(useUnreadStore.getState().channels.c1.count).toBe(0);
  });

  // Review Focus №5.
  it('delete at cap keeps count', () => {
    useUnreadStore.setState((st) => ({ channels: { ...st.channels, c1: { ...st.channels.c1, count: UNREAD_CAP } } }));
    useUnreadStore.getState().applyActivity(act({ op: 'delete' }), 'me');
    expect(useUnreadStore.getState().channels.c1.count).toBe(UNREAD_CAP);
  });

  it('applyActivity on an unknown channel re-hydrates', async () => {
    api.getUnread.mockResolvedValue([]);
    useUnreadStore.getState().applyActivity(act({ channel_id: 'new' }), 'me');
    await vi.waitFor(() => expect(api.getUnread).toHaveBeenCalledTimes(1));
  });

  it('markRead moves the cursor optimistically and sends on the leading edge', () => {
    api.markChannelRead.mockReturnValue(new Promise(() => {}));
    useUnreadStore.getState().markRead('c1', { id: 'm20', created_at: T(20) });
    expect(useUnreadStore.getState().channels.c1.cursor).toEqual({ at: T(20), id: 'm20' });
    expect(api.markChannelRead).toHaveBeenCalledWith('c1', 'm20');
  });

  it('markRead never moves backwards and sends nothing', () => {
    useUnreadStore.getState().markRead('c1', { id: 'm5', created_at: T(5) });
    expect(useUnreadStore.getState().channels.c1.cursor).toEqual({ at: T(10), id: 'm10' });
    expect(api.markChannelRead).not.toHaveBeenCalled();
  });

  it('markRead coalesces a burst into leading + trailing requests', async () => {
    vi.useFakeTimers();
    api.markChannelRead.mockImplementation(async (_c, id) => ({ count: 0, last_read_at: T(Number(id.slice(1))), last_read_message_id: id }));
    const s = useUnreadStore.getState();
    s.markRead('c1', { id: 'm20', created_at: T(20) });
    s.markRead('c1', { id: 'm21', created_at: T(21) });
    s.markRead('c1', { id: 'm22', created_at: T(22) });
    expect(api.markChannelRead).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MARK_READ_WINDOW_MS);
    expect(api.markChannelRead).toHaveBeenCalledTimes(2);
    expect(api.markChannelRead).toHaveBeenLastCalledWith('c1', 'm22');
  });

  it('mark response sets the server count', async () => {
    api.markChannelRead.mockResolvedValue({ count: 1, last_read_at: T(20), last_read_message_id: 'm20' });
    useUnreadStore.getState().markRead('c1', { id: 'm20', created_at: T(20) });
    await vi.waitFor(() => expect(useUnreadStore.getState().channels.c1.count).toBe(1));
  });

  // Review Focus №3.
  it('stale mark response does not override a cursor that is ahead', async () => {
    let resolve!: (v: { count: number; last_read_at: string; last_read_message_id: string }) => void;
    api.markChannelRead.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    useUnreadStore.getState().markRead('c1', { id: 'm20', created_at: T(20) });
    useUnreadStore.setState((st) => ({ channels: { ...st.channels, c1: { ...st.channels.c1, cursor: { at: T(25), id: 'm25' } } } }));
    resolve({ count: 9, last_read_at: T(20), last_read_message_id: 'm20' });
    await Promise.resolve();
    await Promise.resolve();
    expect(useUnreadStore.getState().channels.c1).toEqual({ serverId: 's1', count: 2, cursor: { at: T(25), id: 'm25' } });
  });

  it('applyChannelRead keeps only the maximum', () => {
    const s = useUnreadStore.getState();
    s.applyChannelRead({ channel_id: 'c1', read_at: T(20), message_id: 'm20' });
    s.applyChannelRead({ channel_id: 'c1', read_at: T(15), message_id: 'm15' });
    expect(useUnreadStore.getState().othersRead.c1).toEqual({ at: T(20), id: 'm20' });
  });

  it('loadReceipts applies the others max, ignores null', async () => {
    api.getReadReceipts.mockResolvedValueOnce({ others_max_read_at: null, others_max_read_message_id: null });
    await useUnreadStore.getState().loadReceipts('c1');
    expect(useUnreadStore.getState().othersRead.c1).toBeUndefined();
    api.getReadReceipts.mockResolvedValueOnce({ others_max_read_at: T(12), others_max_read_message_id: 'm12' });
    await useUnreadStore.getState().loadReceipts('c1');
    expect(useUnreadStore.getState().othersRead.c1).toEqual({ at: T(12), id: 'm12' });
  });

  it('selectors and formatting', () => {
    const st = useUnreadStore.getState();
    expect(selectServerUnread('s1')(st)).toBe(5);
    expect(selectServerUnread('nope')(st)).toBe(0);
    expect(selectChannelUnread('c2')(st)).toBe(3);
    expect(formatUnread(99)).toBe('99');
    expect(formatUnread(100)).toBe('99+');
  });

  it('forgetChannel / forgetServer', () => {
    useUnreadStore.getState().forgetChannel('c1');
    expect(useUnreadStore.getState().channels.c1).toBeUndefined();
    useUnreadStore.getState().forgetServer('s1');
    expect(useUnreadStore.getState().channels).toEqual({});
  });
});

describe('firstUnreadId', () => {
  it('no cursor → null (first visit shows no divider)', () => {
    expect(firstUnreadId(undefined, [m('a', T(1))])).toBeNull();
  });
  it('returns the first message after the cursor', () => {
    expect(firstUnreadId({ at: T(1), id: 'a' }, [m('a', T(1)), m('b', T(2))])).toBe('b');
  });
  it('everything read → null', () => {
    expect(firstUnreadId({ at: T(2), id: 'b' }, [m('a', T(1)), m('b', T(2))])).toBeNull();
  });
  it('empty list → null', () => {
    expect(firstUnreadId({ at: T(1), id: 'a' }, [])).toBeNull();
  });
  it('skips a call row, returns the next real message', () => {
    expect(firstUnreadId({ at: T(1), id: 'a' }, [m('a', T(1)), m('call', T(2), 'call'), m('c', T(3))])).toBe('c');
  });
});
