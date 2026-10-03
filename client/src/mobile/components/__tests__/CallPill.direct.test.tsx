// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/services/websocket', () => ({ wsService: { send: vi.fn(), on: vi.fn(() => () => {}) } }));
import { CallPill } from '@/mobile/components/CallPill';
import { useCallStore } from '@/stores/callStore';
import { useDirectCallStore } from '@/stores/directCallStore';

const bob = { id: 'bob', username: 'bob' };

describe('CallPill: звонок 1:1', () => {
  beforeEach(() => {
    useCallStore.getState().reset();
    useDirectCallStore.setState({ phase: { kind: 'idle' }, viewOpen: false, missed: [], lastError: null });
  });
  afterEach(cleanup);

  it('в звонке: «В звонке с bob», цель ведёт на экран звонка, трубка зовёт hangup', () => {
    const hangup = vi.fn();
    useDirectCallStore.setState({ hangup });
    useCallStore.setState({
      callRoomId: 'c1', callKind: 'direct', callPeer: bob, callChannelId: null, callChannelName: null,
      callServerId: null, status: 'connected', isMuted: false, isVideoOff: true,
    });
    const onGoToCall = vi.fn();
    render(<CallPill variant="stacked" onGoToCall={onGoToCall} />);
    expect(screen.getByText(/в звонке с bob|in a call with bob/i)).toBeTruthy();
    // Отдельная строка статуса «В звонке» над «В звонке с bob» — дубль; её нет.
    expect(screen.queryByText(/^(в звонке|in call)$/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /в звонке с bob|in a call with bob/i }));
    expect(onGoToCall).toHaveBeenCalledWith({ kind: 'direct' });
    fireEvent.click(screen.getByRole('button', { name: /покинуть|leave/i }));
    expect(hangup).toHaveBeenCalled();
  });

  it('исходящий без комнаты: «Звоним bob» и отмена', () => {
    const hangup = vi.fn();
    useDirectCallStore.setState({ phase: { kind: 'outgoing', callId: null, peer: bob }, viewOpen: true, hangup });
    const onGoToCall = vi.fn();
    render(<CallPill variant="root" onGoToCall={onGoToCall} />);
    expect(screen.getByText(/звоним bob|calling bob/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /звоним bob|calling bob/i }));
    expect(onGoToCall).toHaveBeenCalledWith({ kind: 'direct' });
    fireEvent.click(screen.getByRole('button', { name: /отменить|cancel/i }));
    expect(hangup).toHaveBeenCalled();
  });

  it('соединение без комнаты: «Соединение…» и отмена', () => {
    const hangup = vi.fn();
    useDirectCallStore.setState({ phase: { kind: 'connecting', callId: 'c', peer: bob }, viewOpen: true, hangup });
    render(<CallPill variant="root" onGoToCall={vi.fn()} />);
    // Одна интерполированная строка, а не склейка «Соединение… bob».
    expect(screen.getByText(/^(соединение с bob…|connecting to bob…)$/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /отменить|cancel/i }));
    expect(hangup).toHaveBeenCalled();
  });

  it('исходящий 1:1 поверх канального звонка: остаётся пилюля канала', () => {
    useCallStore.setState({
      callRoomId: 'ch1', callKind: 'channel', callPeer: null, callChannelId: 'ch1', callChannelName: 'general',
      callServerId: 's1', status: 'connected', isMuted: false, isVideoOff: true,
    });
    useDirectCallStore.setState({ phase: { kind: 'outgoing', callId: null, peer: bob }, viewOpen: true });
    render(<CallPill variant="root" onGoToCall={vi.fn()} />);
    expect(screen.getByText(/#general/)).toBeTruthy();
    expect(screen.getByText(/^(в звонке|in call)$/i)).toBeTruthy(); // у канала статус остаётся
  });

  it('канальный звонок: цель ведёт в канал, трубка зовёт callStore.leave', () => {
    const leave = vi.fn();
    useCallStore.setState({
      callRoomId: 'ch1', callKind: 'channel', callPeer: null, callChannelId: 'ch1', callChannelName: 'general',
      callServerId: 's1', status: 'connected', isMuted: false, isVideoOff: true, leave,
    });
    const onGoToCall = vi.fn();
    render(<CallPill variant="root" onGoToCall={onGoToCall} />);
    fireEvent.click(screen.getByRole('button', { name: /#general/ }));
    expect(onGoToCall).toHaveBeenCalledWith({ kind: 'channel', serverId: 's1', channelId: 'ch1' });
    fireEvent.click(screen.getByRole('button', { name: /покинуть|leave/i }));
    expect(leave).toHaveBeenCalled();
  });
});
