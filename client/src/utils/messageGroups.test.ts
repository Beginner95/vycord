import { describe, it, expect } from 'vitest';
import { GROUP_WINDOW_MS, isContinuation } from './messageGroups';
import type { Message } from '@/types';

const msg = (over: Partial<Message>): Message => ({
  id: '1', channel_id: 'c', user_id: 'u', content: 'hi', kind: 'user',
  created_at: '2026-08-25T12:00:00Z', updated_at: '2026-08-25T12:00:00Z', ...over,
});

describe('isContinuation', () => {
  it('window is 5 minutes', () => expect(GROUP_WINDOW_MS).toBe(300_000));
  it('false without a previous message', () =>
    expect(isContinuation(undefined, msg({}))).toBe(false));
  it('true for same author within 5 min', () =>
    expect(isContinuation(msg({}), msg({ id: '2', created_at: '2026-08-25T12:04:59Z', updated_at: '2026-08-25T12:04:59Z' }))).toBe(true));
  it('false at exactly 5 min', () =>
    expect(isContinuation(msg({}), msg({ id: '2', created_at: '2026-08-25T12:05:00Z', updated_at: '2026-08-25T12:05:00Z' }))).toBe(false));
  it('false for another author', () =>
    expect(isContinuation(msg({}), msg({ id: '2', user_id: 'v', created_at: '2026-08-25T12:01:00Z' }))).toBe(false));
  it('false across a calendar-day boundary even within the window', () =>
    expect(isContinuation(
      msg({ created_at: '2026-08-25T23:58:00' }),   // local time, no Z — day boundary is local
      msg({ id: '2', created_at: '2026-08-26T00:01:00' })
    )).toBe(false));
  it('false when the previous message is a call event', () =>
    expect(isContinuation(
      msg({ kind: 'call' }),
      msg({ id: '2', created_at: '2026-08-25T12:00:30Z' }),
    )).toBe(false));
});
