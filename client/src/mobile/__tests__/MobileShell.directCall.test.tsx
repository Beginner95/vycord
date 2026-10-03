// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import type { AppController } from '@/pages/app/useAppController';

vi.mock('@/services/websocket', () => ({ wsService: { send: vi.fn(), on: vi.fn(() => () => {}) } }));
vi.mock('@/mobile/screens/renderScreen', () => ({
  renderScreen: (s: { kind: string }) => <div data-screen={s.kind} />,
}));
vi.mock('@/mobile/call/CallAudioHost', async () => {
  const { createContext } = await import('react');
  return { CallAudioHost: () => null, CallAudioHostContext: createContext(false) };
});
vi.mock('@/mobile/call/useBackgroundCamera', () => ({ useBackgroundCamera: () => {} }));
vi.mock('@/mobile/call/backgroundAudioDiagnostics', () => ({ useBackgroundAudioDiagnostics: () => {} }));
vi.mock('@/mobile/call/useBackgroundNcBypass', () => ({ useBackgroundNcBypass: () => {} }));
vi.mock('@/pages/app/AppOverlays', () => ({ AppOverlays: () => null }));

import { MobileShell } from '@/mobile/MobileShell';
import { useServerStore } from '@/stores/serverStore';
import { useCallStore } from '@/stores/callStore';
import { useDirectCallStore, DIRECT_CALL_ENDING_MS } from '@/stores/directCallStore';

const bob = { id: 'bob', username: 'bob' };
let go: ReturnType<typeof useNavigate>;
function Grab() { go = useNavigate(); return null; }

const controller = (): AppController => ({
  user: null, servers: [], currentServer: null, channels: [], currentChannel: null, members: [],
  pendingCount: 0, voiceParticipants: new Map(), callNotif: null,
  selectServer: vi.fn(async () => {}), selectChannel: vi.fn(async () => {}), selectHome: vi.fn(),
  joinVoice: vi.fn(), goToCall: vi.fn(), serverRemoved: vi.fn(), channelRemoved: vi.fn(),
  joinServer: vi.fn(async () => {}), serverJoined: vi.fn(), createServer: vi.fn(async () => {}),
  joinCallNotif: vi.fn(), dismissCallNotif: vi.fn(), logout: vi.fn(), subscribe: () => () => {},
  ui: {
    findServerOpen: false, setFindServerOpen: vi.fn(), settingsOpen: false, setSettingsOpen: vi.fn(),
    createChannelOpen: false, setCreateChannelOpen: vi.fn(), createServerOpen: false, setCreateServerOpen: vi.fn(),
  },
} as unknown as AppController);

const mount = () => render(
  <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
    <Grab /><MobileShell c={controller()} />
  </MemoryRouter>,
);
const screens = () => [...document.querySelectorAll('[data-screen]')].map((e) => e.getAttribute('data-screen'));
const top = () => screens()[screens().length - 1];
const flush = () => act(async () => {});

beforeEach(() => {
  useServerStore.setState({ servers: [], serversLoaded: true, currentServer: null, channels: [], currentChannel: null });
  useCallStore.getState().reset();
  useDirectCallStore.setState({ phase: { kind: 'idle' }, viewOpen: false, missed: [], lastError: null });
});
afterEach(cleanup);

describe('MobileShell: звонок 1:1', () => {
  it('исходящий звонок (viewOpen) кладёт экран звонка в стек один раз', async () => {
    mount(); await flush();
    expect(top()).toBe('servers');
    act(() => useDirectCallStore.getState().call(bob));
    await flush();
    expect(top()).toBe('call');
    expect(screens().filter((s) => s === 'call')).toHaveLength(1);
  });

  it('назад с экрана во время звонка закрывает вид и не пушит экран снова (без петли)', async () => {
    mount(); await flush();
    act(() => useDirectCallStore.getState().call(bob));
    await flush();
    expect(top()).toBe('call');
    await act(async () => { go(-1); });
    await flush();
    expect(useDirectCallStore.getState().viewOpen).toBe(false);
    expect(top()).toBe('servers');
    // Пилюля взяла управление.
    expect(document.querySelector('.call-pill')).not.toBeNull();
    // Новых pushей нет и спустя ещё тик.
    await flush();
    expect(top()).toBe('servers');
  });

  it('тап по пилюле возвращает на экран звонка (openView + push)', async () => {
    mount(); await flush();
    act(() => useDirectCallStore.getState().call(bob));
    await flush();
    await act(async () => { go(-1); });
    await flush();
    fireEvent.click(document.querySelector('.call-pill-target')!);
    await flush();
    expect(useDirectCallStore.getState().viewOpen).toBe(true);
    expect(top()).toBe('call');
    expect(screens().filter((s) => s === 'call')).toHaveLength(1);
  });

  it('отмена дозвона (idle) убирает экран звонка из стека', async () => {
    mount(); await flush();
    act(() => useDirectCallStore.getState().call(bob));
    await flush();
    expect(top()).toBe('call');
    act(() => useDirectCallStore.getState().hangup());
    await flush();
    expect(screens()).not.toContain('call');
    expect(top()).toBe('servers');
  });

  it('принятый входящий (connecting) открывает экран звонка', async () => {
    mount(); await flush();
    act(() => useDirectCallStore.setState({ phase: { kind: 'connecting', callId: 'k', peer: bob }, viewOpen: true }));
    await flush();
    expect(top()).toBe('call');
  });

  it('active → ending → idle через DIRECT_CALL_ENDING_MS: экран звонка уходит из стека', async () => {
    vi.useFakeTimers();
    try {
      mount(); await flush();
      act(() => useDirectCallStore.setState({ phase: { kind: 'active', callId: 'k', peer: bob }, viewOpen: true }));
      await flush();
      expect(top()).toBe('call');
      act(() => useDirectCallStore.getState().hangup());
      await flush();
      expect(useDirectCallStore.getState().phase.kind).toBe('ending');
      expect(top()).toBe('call');
      await act(async () => { vi.advanceTimersByTime(DIRECT_CALL_ENDING_MS + 50); });
      expect(useDirectCallStore.getState().phase.kind).toBe('idle');
      expect(screens()).not.toContain('call');
    } finally {
      vi.useRealTimers();
    }
  });

  it('1:1 из канального звонка кончился (отказ): экран, который положил 1:1, снимается', async () => {
    vi.useFakeTimers();
    try {
      useCallStore.setState({ status: 'connected', callKind: 'channel', callRoomId: 'ch1', callChannelId: 'ch1' });
      mount(); await flush();
      act(() => useDirectCallStore.getState().call(bob));
      await flush();
      expect(top()).toBe('call');
      act(() => useDirectCallStore.setState({ phase: { kind: 'ending', peer: bob, reason: 'rejected' } }));
      await flush();
      act(() => useDirectCallStore.setState({ phase: { kind: 'idle' }, viewOpen: false }));
      await flush();
      expect(screens()).not.toContain('call');
      expect(top()).toBe('servers');
    } finally {
      vi.useRealTimers();
    }
  });

  it('канальный экран звонка, на который 1:1 не пушил, при idle остаётся', async () => {
    useCallStore.setState({ status: 'connected', callKind: 'channel', callRoomId: 'ch1', callChannelId: 'ch1' });
    mount(); await flush();
    act(() => useDirectCallStore.setState({ phase: { kind: 'idle' }, viewOpen: false }));
    await flush();
    expect(top()).toBe('servers');
  });

  it('входящий звонок без пилюли: пустой обёртки .mobile-call-dock нет', async () => {
    mount(); await flush();
    act(() => useDirectCallStore.setState({ phase: { kind: 'incoming', callId: 'k', peer: bob, wouldSwitch: false } }));
    await flush();
    expect(document.querySelector('.mobile-call-dock')).toBeNull();
  });
});
