// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { HomeView } from '../HomeView';
import { useFriendStore } from '@/stores/friendStore';
import { useLocaleStore } from '@/stores/localeStore';
import { normalizeHtml, stubBrowser } from './chatHarness';
import type { FriendProfile } from '@/types';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      getOnlineUsers: vi.fn(async () => [{ id: 'u2', username: 'boris' }]),
    },
  };
});
vi.mock('@/services/websocket', () => ({ wsService: { on: vi.fn(() => () => {}), send: vi.fn() } }));

beforeAll(stubBrowser);
beforeEach(() => {
  useLocaleStore.setState({ locale: 'ru' });
  const friend = (user_id: string, username: string): FriendProfile => ({ user_id, username, friends_since: '2026-09-01T00:00:00Z' });
  useFriendStore.setState({
    friends: [friend('u2', 'boris'), friend('u3', 'clara')],
    incoming: [], outgoing: [], blocked: [], loaded: true,
  });
});
afterEach(() => { cleanup(); });

describe('HomeView DOM (снято до очистки VYC-95 этапа 7)', () => {
  it('home with friends panel (online tab)', async () => {
    // Реальные пропсы DesktopShell: <HomeView /> без пропа обратной навигации.
    render(<HomeView />);
    await act(async () => {});
    await expect(normalizeHtml(document.body.innerHTML)).toMatchFileSnapshot('./__snapshots__/HomeView.home.html');
  });
});
