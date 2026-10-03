// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

vi.hoisted(() => {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});
vi.mock('@/services/websocket', () => ({ wsService: { send: vi.fn(), on: vi.fn(() => () => {}) } }));
// Тяжёлые части подменены: проверяем только выбор ветки экрана `call`.
vi.mock('@/components/useCallStageModel', () => ({ useCallStageModel: () => ({}) }));
vi.mock('@/mobile/screens/MobileCallScreen', () => ({
  MobileCallScreen: (p: { onOpenChat?: () => void }) => <div data-testid="mcs" data-chat={p.onOpenChat ? 'yes' : 'no'} />,
}));
vi.mock('@/mobile/call/CallOverflowSheets', () => ({ CallOverflowSheets: () => <div data-testid="sheets" /> }));
vi.mock('@/components/directCall/DirectCallView', () => ({
  DirectCallView: (p: { ignoreViewOpen?: boolean }) => <div data-testid="dcv" data-ignore={String(!!p.ignoreViewOpen)} />,
}));

import { MemoryRouter } from 'react-router-dom';
import { renderScreen } from '@/mobile/screens/renderScreen';
import { useCallStore } from '@/stores/callStore';
import { useDirectCallStore } from '@/stores/directCallStore';
import { controller, nav } from './fixtures';

const bob = { id: 'bob', username: 'bob' };
const show = (c = controller(), n = nav()) => render(
  <MemoryRouter>{renderScreen({ kind: 'call' }, { c, nav: n, joinVoice: vi.fn() })}</MemoryRouter>,
);
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`);

beforeEach(() => {
  useCallStore.getState().reset();
  useDirectCallStore.setState({ phase: { kind: 'idle' }, viewOpen: false, missed: [], lastError: null });
});
afterEach(cleanup);

describe('CallScreen: звонок 1:1', () => {
  it('дозвон: DirectCallView с ignoreViewOpen, без сцены', () => {
    useDirectCallStore.setState({ phase: { kind: 'outgoing', callId: null, peer: bob }, viewOpen: false });
    show();
    expect(q('dcv')?.getAttribute('data-ignore')).toBe('true');
    expect(q('mcs')).toBeNull();
  });

  it('соединение, пока join в полёте (callRoomId null): DirectCallView, а не спиннер', () => {
    useDirectCallStore.setState({ phase: { kind: 'connecting', callId: 'k1', peer: bob } });
    show();
    expect(q('dcv')).not.toBeNull();
    expect(document.querySelector('.mobile-screen-loading')).toBeNull();
  });

  it('исход (ending): DirectCallView', () => {
    useDirectCallStore.setState({ phase: { kind: 'ending', peer: bob, reason: 'rejected' } });
    show();
    expect(q('dcv')).not.toBeNull();
  });

  it('в комнате звонка: MobileCallScreen без кнопки чата, шторки на месте', () => {
    useCallStore.setState({ callKind: 'direct', callRoomId: 'k1', callPeer: bob, callChannelId: null, status: 'connected' });
    useDirectCallStore.setState({ phase: { kind: 'active', callId: 'k1', peer: bob } });
    show();
    expect(q('mcs')?.getAttribute('data-chat')).toBe('no');
    expect(q('sheets')).not.toBeNull();
    expect(q('dcv')).toBeNull();
  });

  it('входящий Y поверх активного X: остаётся сцена X', () => {
    useCallStore.setState({ callKind: 'direct', callRoomId: 'kX', callPeer: bob, callChannelId: null, status: 'connected' });
    useDirectCallStore.setState({ phase: { kind: 'incoming', callId: 'kY', peer: { id: 'z', username: 'zed' }, wouldSwitch: true } });
    show();
    expect(q('mcs')).not.toBeNull();
    expect(q('dcv')).toBeNull();
  });

  it('канальный звонок: сцена с кнопкой чата (регрессия)', () => {
    const ch = { id: 'c1', server_id: 's1', name: 'общий', position: 0, created_at: '', updated_at: '' };
    useCallStore.setState({ callKind: 'channel', callRoomId: 'c1', callChannelId: 'c1', status: 'connected' });
    show(controller({ currentChannel: ch }));
    expect(q('mcs')?.getAttribute('data-chat')).toBe('yes');
  });

  it('звоним Y из активного звонка 1:1 X: виден дозвон, а не сцена X', () => {
    useCallStore.setState({ callKind: 'direct', callRoomId: 'kX', callPeer: bob, callChannelId: null, status: 'connected' });
    useDirectCallStore.setState({ phase: { kind: 'outgoing', callId: null, peer: { id: 'z', username: 'zed' } } });
    show();
    expect(q('dcv')).not.toBeNull();
    expect(q('mcs')).toBeNull();
  });

  it('звоним из канального звонка: виден дозвон', () => {
    useCallStore.setState({ callKind: 'channel', callRoomId: 'c1', callChannelId: 'c1', status: 'connected' });
    useDirectCallStore.setState({ phase: { kind: 'outgoing', callId: null, peer: bob } });
    show();
    expect(q('dcv')).not.toBeNull();
  });

  it('на экране дозвона есть «Свернуть»: closeView + back, звонок не завершается', () => {
    const hangup = vi.fn();
    useDirectCallStore.setState({ phase: { kind: 'outgoing', callId: null, peer: bob }, viewOpen: true, hangup });
    const n = nav();
    show(controller(), n);
    fireEvent.click(document.querySelector('.mobile-direct-collapse')!);
    expect(useDirectCallStore.getState().viewOpen).toBe(false);
    expect(n.back).toHaveBeenCalledTimes(1);
    expect(hangup).not.toHaveBeenCalled();
  });
});
