// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const listeners = new Map<string, (p: unknown) => void>();
vi.mock('@/services/websocket', () => ({
  wsService: {
    on: (type: string, fn: (p: unknown) => void) => { listeners.set(type, fn); return () => listeners.delete(type); },
  },
}));
vi.mock('@/services/api', async (orig) => ({
  ...(await orig<typeof import('@/services/api')>()),
  apiService: { addReaction: vi.fn(), removeReaction: vi.fn() },
}));

import { apiService } from '@/services/api';
import { useMessageStore, type ChatMessage } from '@/stores/messageStore';
import { useMessageReactions } from '../useMessageReactions';

const api = vi.mocked(apiService);
const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', channel_id: 'c1', user_id: 'u2', kind: 'user', content: 'x', created_at: 't', updated_at: 't', ...over,
});
const reactionsOf = () => useMessageStore.getState().messages[0].reactions;

beforeEach(() => {
  listeners.clear();
  api.addReaction.mockReset();
  api.removeReaction.mockReset();
  useMessageStore.getState().setMessages([msg()]);
});

describe('useMessageReactions', () => {
  it('adds optimistically, then applies the server snapshot', async () => {
    let resolve!: (v: unknown) => void;
    api.addReaction.mockReturnValue(new Promise((r) => { resolve = r; }) as never);
    const { result } = renderHook(() => useMessageReactions('c1', 'u1', vi.fn()));

    let pending!: Promise<void>;
    act(() => { pending = result.current.toggle('m1', '👍'); });
    expect(reactionsOf()).toEqual([{ key: '👍', emoji: '👍', count: 1, user_ids: ['u1'] }]);
    expect(api.addReaction).toHaveBeenCalledWith('c1', 'm1', '👍');

    const server = [{ key: '👍', emoji: '👍', count: 2, user_ids: ['u2', 'u1'] }];
    await act(async () => { resolve({ message_id: 'm1', reactions: server }); await pending; });
    expect(reactionsOf()).toEqual(server);
  });

  it('removes when already reacted, and applies an empty snapshot', async () => {
    useMessageStore.getState().setMessages([msg({ reactions: [{ key: '👍', emoji: '👍', count: 1, user_ids: ['u1'] }] })]);
    api.removeReaction.mockResolvedValue({ message_id: 'm1', reactions: [] });
    const { result } = renderHook(() => useMessageReactions('c1', 'u1', vi.fn()));
    await act(() => result.current.toggle('m1', '👍'));
    expect(api.removeReaction).toHaveBeenCalledWith('c1', 'm1', '👍');
    expect(reactionsOf()).toEqual([]);
  });

  it('rolls back and reports on failure', async () => {
    api.addReaction.mockRejectedValue(new Error('limit'));
    const onError = vi.fn();
    const { result } = renderHook(() => useMessageReactions('c1', 'u1', onError));
    await act(() => result.current.toggle('m1', '🔥'));
    expect(reactionsOf()).toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('applies WS snapshots of its own channel only', () => {
    renderHook(() => useMessageReactions('c1', 'u1', vi.fn()));
    const snap = [{ key: '😂', emoji: '😂', count: 1, user_ids: ['u2'] }];
    act(() => listeners.get('message_reactions')!({ channel_id: 'c2', message_id: 'm1', reactions: snap }));
    expect(reactionsOf()).toBeUndefined();
    act(() => listeners.get('message_reactions')!({ channel_id: 'c1', message_id: 'm1', reactions: snap }));
    expect(reactionsOf()).toEqual(snap);
    act(() => listeners.get('message_reactions')!({ channel_id: 'c1', message_id: 'm1', reactions: [] }));
    expect(reactionsOf()).toEqual([]);
  });

  it('does nothing without a user or channel', async () => {
    const { result } = renderHook(() => useMessageReactions(undefined, undefined, vi.fn()));
    await act(() => result.current.toggle('m1', '👍'));
    expect(api.addReaction).not.toHaveBeenCalled();
  });
});
