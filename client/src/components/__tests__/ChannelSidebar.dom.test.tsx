// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ChannelSidebar } from '../ChannelSidebar';
import { useServerStore } from '@/stores/serverStore';
import { useAuthStore } from '@/stores/authStore';
import { useCallStore } from '@/stores/callStore';
import { useLocaleStore } from '@/stores/localeStore';
import { PERMISSIONS } from '@/utils/permissions';
import { channel, me, normalizeHtml, otherUser, serverA, stubBrowser } from './chatHarness';
import type { Channel } from '@/types';

vi.mock('@/services/websocket', () => ({ wsService: { on: vi.fn(() => () => {}), send: vi.fn() } }));

beforeAll(stubBrowser);
beforeEach(() => {
  useLocaleStore.setState({ locale: 'ru' });
  useAuthStore.setState({ user: me });
  useCallStore.setState({ callChannelId: null });
  useServerStore.setState({
    currentServer: serverA, servers: [serverA], members: [otherUser], channels: [channel],
    permissions: new Map([[serverA.id, { isOwner: true, bits: PERMISSIONS.MANAGE_CHANNELS, highestPosition: 0 }]]),
  });
});
afterEach(() => { cleanup(); });

const second: Channel = { ...channel, id: 'c2', name: 'random', position: 1 };
const snap = (name: string) => expect(normalizeHtml(document.body.innerHTML)).toMatchFileSnapshot(`./__snapshots__/ChannelSidebar.${name}.html`);

/** Реальные пропсы DesktopShell: проп обратной навигации не передаётся. */
const mount = (over: Partial<React.ComponentProps<typeof ChannelSidebar>> = {}) => render(
  <ChannelSidebar
    server={serverA}
    channels={[channel, second]}
    currentChannel={channel}
    onSelectChannel={vi.fn()}
    onJoinVoice={vi.fn()}
    user={me}
    voiceParticipants={new Map([['c2', ['u2']]])}
    members={[otherUser]}
    onChannelDeleted={vi.fn()}
    onServerDeleted={vi.fn()}
    onCreateChannel={vi.fn()}
    {...over}
  />,
);

describe('ChannelSidebar DOM (снято до очистки VYC-95 этапа 7)', () => {
  it('server with text channel and voice card', async () => { mount(); await snap('server'); });
  it('no server (Дом)', async () => { mount({ server: null, channels: [], currentChannel: null }); await snap('home'); });
});
