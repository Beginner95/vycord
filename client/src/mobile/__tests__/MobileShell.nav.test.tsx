// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppController } from '@/pages/app/useAppController';
import type { Server, Channel } from '@/types';

vi.mock('@/mobile/screens/renderScreen', () => ({
  renderScreen: (s: { kind: string }) => <div data-screen={s.kind} />,
}));
vi.mock('@/pages/app/AppOverlays', () => ({ AppOverlays: () => null }));
vi.mock('@/components/CallUI', () => ({ CallUI: () => null }));
vi.mock('@/components/CallDock', () => ({ CallDock: () => null }));

import { MobileShell } from '@/mobile/MobileShell';
import { useServerStore } from '@/stores/serverStore';

afterEach(cleanup);

const server = { id: 's1', name: 'S' } as Server;
const channel = { id: 'c1', name: 'general', server_id: 's1' } as Channel;

function fakeController(over: Partial<AppController> = {}): AppController {
  return {
    user: null, servers: [server], currentServer: null, channels: [], currentChannel: null, members: [],
    pendingCount: 2, voiceParticipants: new Map(), callNotif: null,
    selectServer: vi.fn(async () => {}), selectChannel: vi.fn(async () => {}), selectHome: vi.fn(),
    joinVoice: vi.fn(), goToCall: vi.fn(), serverRemoved: vi.fn(), channelRemoved: vi.fn(),
    joinServer: vi.fn(async () => {}), serverJoined: vi.fn(), createServer: vi.fn(async () => {}),
    joinCallNotif: vi.fn(), dismissCallNotif: vi.fn(), logout: vi.fn(),
    subscribe: () => () => {},
    ui: {
      findServerOpen: false, setFindServerOpen: vi.fn(), settingsOpen: false, setSettingsOpen: vi.fn(),
      createChannelOpen: false, setCreateChannelOpen: vi.fn(), createServerOpen: false, setCreateServerOpen: vi.fn(),
    },
    ...over,
  };
}

const mount = (c: AppController, state?: unknown) => render(
  <MemoryRouter initialEntries={[{ pathname: '/app', state }]}><MobileShell c={c} /></MemoryRouter>,
);
const top = () => {
  const els = [...document.querySelectorAll('[data-screen]')];
  return els[els.length - 1]?.getAttribute('data-screen');
};

beforeEach(() => {
  useServerStore.setState({ servers: [server], serversLoaded: true, currentServer: null, channels: [], currentChannel: null });
});

describe('MobileShell navigation', () => {
  it('cold start lands on the servers root with the tab bar', async () => {
    mount(fakeController());
    await act(async () => {});
    expect(top()).toBe('servers');
    expect(document.querySelector('.tab-bar')).not.toBeNull();
  });

  it('a restored deep stack asks the controller to select its server (no chat auto-open)', async () => {
    const c = fakeController();
    mount(c, { m: [{ kind: 'servers' }, { kind: 'channels', serverId: 's1' }], b: 1 });
    await act(async () => {});
    expect(c.selectServer).toHaveBeenCalledWith(server);
    expect(top()).toBe('channels');
    expect(document.querySelector('.tab-bar')).toBeNull();
  });

  it('selects the channel of the chat screen once its server is current', async () => {
    useServerStore.setState({ currentServer: server, channels: [channel] });
    const c = fakeController({ currentServer: server, channels: [channel] });
    mount(c, { m: [{ kind: 'servers' }, { kind: 'channels', serverId: 's1' }, { kind: 'chat', channelId: 'c1' }], b: 2 });
    await act(async () => {});
    expect(c.selectChannel).toHaveBeenCalledWith(channel);
  });

  it('tab bar switches tabs and shows the friends badge', async () => {
    mount(fakeController());
    await act(async () => {});
    expect(document.querySelector('.tab-bar-badge')?.textContent).toBe('2');
    fireEvent.click(document.querySelectorAll('.tab-bar-item')[1]);
    await act(async () => {});
    expect(top()).toBe('friends');
  });

  it('strips a sheet entry that survived a reload', async () => {
    // top() alone doesn't prove normalization happened: `visible` in
    // MobileShell already filters sheet entries out of what gets rendered,
    // regardless of whether nav.stack itself was cleaned up — so this
    // assertion alone stays green even with stripSheets() disabled. The tab
    // bar is the observable that actually depends on the stack: it renders
    // only when isRoot(nav.stack), i.e. stack.length === 1. A hanging sheet
    // entry keeps the stack at length 2 (not root) until stripSheets runs;
    // if it never ran, the tab bar would never appear.
    mount(fakeController(), { m: [{ kind: 'servers' }, { kind: 'sheet', id: 'x' }], b: 1 });
    await act(async () => {});
    expect(top()).toBe('servers');
    expect(document.querySelector('.tab-bar')).not.toBeNull();
  });
});
