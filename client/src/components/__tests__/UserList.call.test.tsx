// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { UserList } from '../UserList';
import { useServerStore } from '@/stores/serverStore';
import { useAuthStore } from '@/stores/authStore';
import { useLocaleStore } from '@/stores/localeStore';
import { channel, me, serverA, stubBrowser } from './chatHarness';
import type { MemberWithUser } from '@/types';

// Реальный стор тянет callStore/SFU; тесту нужен лишь вызов call(peer).
const { callSpy } = vi.hoisted(() => ({ callSpy: vi.fn() }));
vi.mock('@/stores/directCallStore', () => ({
  useDirectCallStore: { getState: () => ({ call: callSpy }) },
}));
vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      // Онлайн: boris и сам пользователь; clara — офлайн.
      getOnlineUsers: vi.fn(async () => [{ id: 'u2', username: 'boris' }, { id: me.id, username: me.username }]),
      getLastSeenBatch: vi.fn(async () => ({})),
    },
  };
});
vi.mock('@/services/websocket', () => ({ wsService: { on: vi.fn(() => () => {}), send: vi.fn() } }));

beforeAll(stubBrowser);
beforeEach(() => {
  vi.clearAllMocks();
  useLocaleStore.setState({ locale: 'ru' });
  useAuthStore.setState({ user: me });
});
afterEach(cleanup);

const member = (user_id: string, username: string): MemberWithUser => ({ user_id, username, roles: [], joined_at: '' });

describe('UserList — кнопка звонка 1:1', () => {
  it('у онлайн-участника кнопка зовёт call(peer); у офлайна и у себя кнопки нет', async () => {
    useServerStore.setState({
      currentServer: serverA, servers: [serverA], channels: [channel],
      members: [member('u2', 'boris'), member(me.id, me.username), member('u3', 'clara')],
    });
    render(<UserList voiceParticipants={new Map()} />);
    await act(async () => {});
    const btns = document.querySelectorAll('.call-user-btn');
    expect(btns).toHaveLength(1);
    fireEvent.click(btns[0]);
    expect(callSpy).toHaveBeenCalledWith({ id: 'u2', username: 'boris', avatar_url: undefined });
  });
});
