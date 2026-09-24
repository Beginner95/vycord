// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppController } from '@/pages/app/useAppController';
import type { Server } from '@/types';
import type { ScreenCtx } from '@/mobile/screens/renderScreen';

// Экраны — заглушки; у чата кнопка, открывающая шторку (как лайтбокс
// картинки через BackDismissGate: запись kind:'sheet' в стеке).
vi.mock('@/mobile/screens/renderScreen', () => ({
  renderScreen: (s: { kind: string }, ctx: ScreenCtx) => (
    <div data-screen={s.kind}>
      {s.kind === 'chat' && (
        <button type="button" data-open-sheet onClick={() => ctx.nav.push({ kind: 'sheet', id: 'lightbox' })} />
      )}
    </div>
  ),
}));
vi.mock('@/pages/app/AppOverlays', () => ({ AppOverlays: () => null }));
vi.mock('@/components/CallUI', () => ({ CallUI: () => null }));
vi.mock('@/components/CallDock', () => ({ CallDock: () => null }));
vi.mock('@/mobile/components/CallPill', () => ({ CallPill: () => null }));

import { MobileShell } from '@/mobile/MobileShell';
import { useServerStore } from '@/stores/serverStore';
import { useCallStore } from '@/stores/callStore';
import { stubBrowser } from '@/components/__tests__/callHarness';

const server = { id: 's1', name: 'S' } as Server;

function fakeController(): AppController {
  return {
    user: null, servers: [server], currentServer: null, channels: [], currentChannel: null, members: [],
    pendingCount: 0, voiceParticipants: new Map(), callNotif: null,
    selectServer: vi.fn(async () => {}), selectChannel: vi.fn(async () => {}), selectHome: vi.fn(),
    joinVoice: vi.fn(), goToCall: vi.fn(), serverRemoved: vi.fn(), channelRemoved: vi.fn(),
    joinServer: vi.fn(async () => {}), serverJoined: vi.fn(), createServer: vi.fn(async () => {}),
    joinCallNotif: vi.fn(), dismissCallNotif: vi.fn(), logout: vi.fn(),
    subscribe: () => () => {},
    ui: {
      findServerOpen: false, setFindServerOpen: vi.fn(), settingsOpen: false, setSettingsOpen: vi.fn(),
      createChannelOpen: false, setCreateChannelOpen: vi.fn(), createServerOpen: false, setCreateServerOpen: vi.fn(),
    },
  };
}

const stream = {
  id: 's2', getAudioTracks: () => [], getVideoTracks: () => [], getTracks: () => [],
  addEventListener: () => {}, removeEventListener: () => {},
} as unknown as MediaStream;

const base = [{ kind: 'servers' }, { kind: 'channels', serverId: 's1' }, { kind: 'chat', channelId: 'c1' }];
const mount = (m: unknown[]) => render(
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m, b: m.length - 1 } }]}>
    <MobileShell c={fakeController()} />
  </MemoryRouter>,
);
const screens = () => [...document.querySelectorAll('[data-screen]')].map((el) => el.getAttribute('data-screen'));
const hostAudio = () => document.querySelector<HTMLAudioElement>('.call-audio-host audio');

beforeAll(() => {
  stubBrowser();
  HTMLMediaElement.prototype.pause = vi.fn();
});
beforeEach(() => {
  useServerStore.setState({ servers: [server], serversLoaded: true, currentServer: null, channels: [], currentChannel: null });
});
afterEach(() => { cleanup(); useCallStore.getState().reset(); });

describe('MobileShell: call audio does not depend on the nav stack', () => {
  const inCall = () => useCallStore.setState({
    status: 'connected', callChannelId: 'c1', callServerId: 's1',
    participants: [{ userId: 'u2', stream }],
  });

  it('[…, call, chat, sheet]: the call screen is unmounted, the audio host keeps playing', async () => {
    inCall();
    mount([...base, { kind: 'call' }, { kind: 'chat', channelId: 'c1' }]);
    await act(async () => {});
    expect(screens()).toEqual(['call', 'chat']);
    expect(hostAudio()?.srcObject).toBe(stream);

    fireEvent.click(document.querySelector('.mobile-screen.is-top [data-open-sheet]')!);
    await act(async () => {});
    // slice(-2) = [chat, sheet] → sheet отфильтрован: экрана звонка нет.
    expect(screens()).toEqual(['chat']);
    const el = hostAudio();
    expect(el).toBeTruthy();
    expect(el!.srcObject).toBe(stream);
  });

  it('collapsed call ([…, chat]): the host is mounted without the call screen', async () => {
    inCall();
    mount(base);
    await act(async () => {});
    expect(screens()).not.toContain('call');
    expect(hostAudio()?.srcObject).toBe(stream);
  });

  it('no call: no host', async () => {
    mount(base);
    await act(async () => {});
    expect(document.querySelector('.call-audio-host')).toBeNull();
  });
});
