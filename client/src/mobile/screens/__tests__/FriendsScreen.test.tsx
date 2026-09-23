// client/src/mobile/screens/__tests__/FriendsScreen.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FriendsScreen } from '@/mobile/screens/FriendsScreen';
import { useFriendStore } from '@/stores/friendStore';
import { callService } from '@/services/call';
import type { FriendProfile, FriendRequest, UserBrief } from '@/types';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      getOnlineUsers: vi.fn(async () => [{ id: 'u2' }]),
      acceptFriendRequest: vi.fn(async () => {}),
      deleteFriendRequest: vi.fn(async () => {}),
      removeFriend: vi.fn(async () => {}),
      blockUser: vi.fn(async () => {}),
      unblockUser: vi.fn(async () => {}),
    },
  };
});
vi.mock('@/services/websocket', () => ({ wsService: { on: vi.fn(() => () => {}), send: vi.fn() } }));
vi.mock('@/services/call', () => ({ callService: { startCall: vi.fn(async () => null) } }));

const boris: FriendProfile = { user_id: 'u2', username: 'Борис', friends_since: '' };
const vera: FriendProfile = { user_id: 'u3', username: 'Вера', friends_since: '' };
const req = (id: string, user: UserBrief): FriendRequest => ({ id, user, created_at: '' });

beforeEach(() => {
  vi.clearAllMocks();
  useFriendStore.setState({
    friends: [boris, vera],
    incoming: [req('r1', { user_id: 'u4', username: 'Галя' })],
    outgoing: [req('r2', { user_id: 'u5', username: 'Денис' })],
    blocked: [{ user_id: 'u6', username: 'Ева' }],
    load: vi.fn(async () => {}),
  });
});
afterEach(cleanup);

// FriendsScreen рендерит ActionSheet/BottomSheet, которые изнутри держатся на
// useBackDismiss → useMobileNav → useLocation() (react-router) — без Router
// вокруг рендер падает ("useLocation() may be used only in the context of a
// <Router> component"). Тот же паттерн, что в остальных mobile screen-тестах
// (ChannelsScreen.test.tsx и др.).
const mount = () => render(
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
    <FriendsScreen />
  </MemoryRouter>,
);

describe('FriendsScreen (VYC-95 этап 5)', () => {
  it('вкладка «В сети» по умолчанию показывает только друзей онлайн', async () => {
    mount();
    await waitFor(() => expect(document.body.textContent).toContain('Борис'));
    expect(document.body.textContent).not.toContain('Вера');
  });

  it('вкладка «Все» показывает всех друзей', async () => {
    mount();
    fireEvent.click(document.querySelectorAll('.friends-segment')[1]);
    await waitFor(() => expect(document.body.textContent).toContain('Вера'));
  });

  it('«Ожидание»: инлайн «Принять» зовёт apiService.acceptFriendRequest', async () => {
    const { apiService } = await import('@/services/api');
    mount();
    fireEvent.click(document.querySelectorAll('.friends-segment')[2]);
    await waitFor(() => expect(document.body.textContent).toContain('Галя'));
    fireEvent.click([...document.querySelectorAll('.friends-pending-btn')].find((b) => b.textContent === 'Принять')!);
    await waitFor(() => expect(apiService.acceptFriendRequest).toHaveBeenCalledWith('r1'));
  });

  it('тап по строке друга открывает ActionSheet, «Позвонить» зовёт callService', async () => {
    mount();
    await waitFor(() => expect(document.body.textContent).toContain('Борис'));
    fireEvent.click(document.querySelector('.mobile-row')!);
    expect(document.body.textContent).toContain('Позвонить Борис');
    fireEvent.click([...document.querySelectorAll('.action-sheet-item')].find((b) => b.textContent?.includes('Позвонить'))!);
    expect(callService.startCall).toHaveBeenCalledWith('u2');
  });

  it('«+» открывает шторку с AddFriendForm', () => {
    mount();
    fireEvent.click(document.querySelector('.screen-header-btn')!);
    expect(document.querySelector('.add-friend-form')).not.toBeNull();
  });

  it('«Заблокированные»: меню показывает только «Разблокировать»', async () => {
    mount();
    fireEvent.click(document.querySelectorAll('.friends-segment')[3]);
    await waitFor(() => expect(document.body.textContent).toContain('Ева'));
    fireEvent.click(document.querySelector('.mobile-row')!);
    expect(document.body.textContent).toContain('Разблокировать');
    expect(document.body.textContent).not.toContain('Позвонить');
  });
});
