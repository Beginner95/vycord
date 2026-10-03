// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/components/CallStage', () => ({ CallStage: () => <div data-testid="stage" /> }));
vi.mock('@/services/websocket', () => ({ wsService: { send: vi.fn(), on: vi.fn(() => () => {}) } }));
import { DirectCallView } from '@/components/directCall/DirectCallView';
import { useDirectCallStore } from '@/stores/directCallStore';
import { useCallStore } from '@/stores/callStore';

const bob = { id: 'bob', username: 'bob' };

describe('DirectCallView', () => {
  beforeEach(() => {
    useDirectCallStore.setState({ phase: { kind: 'idle' }, viewOpen: false, missed: [], lastError: null });
    useCallStore.setState({ callRoomId: null, callKind: null, callPeer: null });
  });
  afterEach(cleanup);

  it('ничего не рисует, пока экран закрыт', () => {
    useDirectCallStore.setState({ phase: { kind: 'active', callId: 'c', peer: bob }, viewOpen: false });
    const { container } = render(<DirectCallView />);
    expect(container.childElementCount).toBe(0);
  });

  it('ничего не рисует для входящего и idle', () => {
    useDirectCallStore.setState({ phase: { kind: 'incoming', callId: 'c', peer: bob, wouldSwitch: false }, viewOpen: true });
    const { container, rerender } = render(<DirectCallView />);
    expect(container.childElementCount).toBe(0);
    useDirectCallStore.setState({ phase: { kind: 'idle' } });
    rerender(<DirectCallView />);
    expect(container.childElementCount).toBe(0);
  });

  it('исходящий: имя, «Звоним…», кнопка «Отменить» вызывает hangup', () => {
    const hangup = vi.fn();
    useDirectCallStore.setState({ phase: { kind: 'outgoing', callId: 'c', peer: bob }, viewOpen: true, hangup });
    render(<DirectCallView />);
    expect(screen.getByText('bob')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /отменить|cancel/i }));
    expect(hangup).toHaveBeenCalled();
  });

  it('активный и соединение в комнате: сцена звонка', () => {
    useCallStore.setState({ callRoomId: 'c', callKind: 'direct', callPeer: bob });
    useDirectCallStore.setState({ phase: { kind: 'active', callId: 'c', peer: bob }, viewOpen: true });
    const { rerender } = render(<DirectCallView />);
    expect(screen.getByTestId('stage')).toBeTruthy();
    useDirectCallStore.setState({ phase: { kind: 'connecting', callId: 'c', peer: bob } });
    rerender(<DirectCallView />);
    expect(screen.getByTestId('stage')).toBeTruthy();
  });

  it('исход: текст причины', () => {
    useDirectCallStore.setState({ phase: { kind: 'ending', peer: bob, reason: 'timeout' }, viewOpen: true });
    render(<DirectCallView />);
    expect(screen.getByText(/не отвечает|no answer/i)).toBeTruthy();
  });

  it('соединение без комнаты: «Соединение…» и отмена, без сцены', () => {
    const hangup = vi.fn();
    useDirectCallStore.setState({ phase: { kind: 'connecting', callId: 'c', peer: bob }, viewOpen: true, hangup });
    render(<DirectCallView />);
    expect(screen.queryByTestId('stage')).toBeNull();
    expect(screen.getByText(/соединение|connecting/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /отменить|cancel/i }));
    expect(hangup).toHaveBeenCalled();
  });

  it('входящий Y поверх активного 1:1 X: остаётся сцена X', () => {
    useCallStore.setState({ callRoomId: 'x', callKind: 'direct', callPeer: bob });
    useDirectCallStore.setState({ phase: { kind: 'incoming', callId: 'y', peer: { id: 'y', username: 'yan' }, wouldSwitch: true }, viewOpen: true });
    render(<DirectCallView />);
    expect(screen.getByTestId('stage')).toBeTruthy();
  });
});
