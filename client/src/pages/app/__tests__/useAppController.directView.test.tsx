// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/services/websocket', () => ({
  wsService: { send: vi.fn(), on: vi.fn(() => () => {}), connected: true, connect: vi.fn(), joinChannel: vi.fn() },
}));
vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      getServers: vi.fn(async () => [{ id: 's1', name: 'S' }]),
      getMe: vi.fn(async () => ({})),
      getChannels: vi.fn(async () => [{ id: 'c1', server_id: 's1', name: 'general', type: 'text' }]),
      getMessages: vi.fn(async () => []),
      getServerMembers: vi.fn(async () => []),
      updateLastVisited: vi.fn(async () => {}),
      getFreshAccessToken: vi.fn(async () => null),
      getFriends: vi.fn(async () => []),
      getMyPermissions: vi.fn(async () => ({})),
      logout: vi.fn(async () => {}),
    },
  };
});
vi.mock('../useCallRing', () => ({ useCallRing: () => ({ callNotif: null, dismiss: vi.fn() }) }));
vi.mock('../useVoiceParticipants', () => ({ useVoiceParticipants: () => new Map() }));

import { useAppController } from '../useAppController';
import { useDirectCallStore } from '@/stores/directCallStore';
import { useServerStore } from '@/stores/serverStore';

describe('useAppController: экран звонка 1:1 и навигация', () => {
  beforeEach(() => {
    useDirectCallStore.setState({ phase: { kind: 'idle' }, viewOpen: true, missed: [], lastError: null });
  });

  it('автонавигация не закрывает экран, пользовательский выбор — закрывает', async () => {
    const { result } = renderHook(() => useAppController({ autoOpenChannel: true }));
    await waitFor(() => expect(useServerStore.getState().currentChannel?.id).toBe('c1'));
    expect(useDirectCallStore.getState().viewOpen).toBe(true);
    await act(async () => { await result.current.selectChannel(useServerStore.getState().channels[0]); });
    expect(useDirectCallStore.getState().viewOpen).toBe(false);
  });

  it('выход из аккаунта сбрасывает стор звонков 1:1', async () => {
    const bob = { id: 'bob', username: 'bob' };
    const { result } = renderHook(() => useAppController({ autoOpenChannel: false }));
    act(() => useDirectCallStore.setState({
      phase: { kind: 'outgoing', callId: 'c1', peer: bob }, viewOpen: true,
      missed: [{ callId: 'm1', peer: bob, at: 1 }], lastError: 'busy',
    }));
    act(() => result.current.logout());
    expect(useDirectCallStore.getState()).toMatchObject({ phase: { kind: 'idle' }, missed: [], lastError: null, viewOpen: false });
  });
});
