// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ChannelSidebar } from '../ChannelSidebar';
import { useServerStore } from '@/stores/serverStore';
import { useAuthStore } from '@/stores/authStore';
import { useCallStore } from '@/stores/callStore';
import { useLocaleStore } from '@/stores/localeStore';
import { useUnreadStore } from '@/stores/unreadStore';
import { channel, me, otherUser, serverA, stubBrowser } from './chatHarness';
import type { Channel } from '@/types';

vi.mock('@/services/websocket', () => ({ wsService: { on: vi.fn(() => () => {}), send: vi.fn() } }));

const second: Channel = { ...channel, id: 'c2', name: 'random', position: 1 };
const cur = { at: '2026-10-03T10:00:00Z', id: null };

beforeAll(stubBrowser);
beforeEach(() => {
  useLocaleStore.setState({ locale: 'ru' });
  useAuthStore.setState({ user: me });
  useCallStore.setState({ callChannelId: null });
  useServerStore.setState({ currentServer: serverA, servers: [serverA], members: [otherUser], channels: [channel, second], permissions: new Map() });
  useUnreadStore.setState({ channels: { [channel.id]: { serverId: serverA.id, count: 0, cursor: cur }, c2: { serverId: serverA.id, count: 5, cursor: cur } } });
});
afterEach(cleanup);

const mount = (voice = new Map<string, string[]>()) => render(
  <ChannelSidebar server={serverA} channels={[channel, second]} currentChannel={channel} onSelectChannel={vi.fn()}
    onJoinVoice={vi.fn()} user={me} voiceParticipants={voice} members={[otherUser]}
    onChannelDeleted={vi.fn()} onServerDeleted={vi.fn()} onCreateChannel={vi.fn()} />,
);

describe('ChannelSidebar unread pill', () => {
  it('text row: pill with count and has-unread, none for zero', () => {
    mount();
    const rows = document.querySelectorAll('.channel-row');
    expect(rows[0].querySelector('.channel-unread-pill')).toBeNull();
    expect(rows[0].classList.contains('has-unread')).toBe(false);
    expect(rows[1].querySelector('.channel-unread-pill')?.textContent).toBe('5');
    expect(rows[1].classList.contains('has-unread')).toBe(true);
  });

  it('voice card row also shows the pill', () => {
    mount(new Map([['c2', ['u2']]]));
    expect(document.querySelector('.voice-card .channel-unread-pill')?.textContent).toBe('5');
  });
});
