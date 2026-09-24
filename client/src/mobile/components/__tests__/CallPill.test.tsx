// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { CallPill } from '@/mobile/components/CallPill';
import { useCallStore } from '@/stores/callStore';
import { useServerStore } from '@/stores/serverStore';

vi.mock('@/services/groupCall', () => ({
  groupCallService: {
    currentRoomIdState: null,
    isScreenSharing: false,
    toggleMuteAudio: vi.fn(() => true),
    toggleMuteVideo: vi.fn(() => true),
    leaveGroupCall: vi.fn(),
  },
}));
vi.mock('@/services/callBus', () => ({ callBus: { send: vi.fn(), on: vi.fn(() => () => {}) } }));
vi.mock('@/services/audio', () => ({ audioService: { playUserLeft: vi.fn(), playUserJoined: vi.fn() } }));

afterEach(() => { cleanup(); useCallStore.getState().reset(); });

describe('CallPill', () => {
  it('renders nothing when status is idle', () => {
    useCallStore.setState({ status: 'idle', callChannelId: null });
    const { container } = render(<CallPill variant="root" onGoToCall={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders with .is-root or .is-stacked per the variant prop', () => {
    useCallStore.setState({
      status: 'connected', callChannelId: 'c1', callChannelName: 'general', callServerId: 's1', callServerName: 'Alpha',
    });
    const { rerender } = render(<CallPill variant="root" onGoToCall={() => {}} />);
    expect(document.querySelector('.call-pill.is-root')).not.toBeNull();
    rerender(<CallPill variant="stacked" onGoToCall={() => {}} />);
    expect(document.querySelector('.call-pill.is-stacked')).not.toBeNull();
  });

  it('clicking mic/video/leave calls the matching store methods', () => {
    useCallStore.setState({
      status: 'connected', callChannelId: 'c1', callChannelName: 'general', callServerId: 's1', callServerName: 'Alpha',
      isMuted: false, isVideoOff: false,
    });
    render(<CallPill variant="root" onGoToCall={() => {}} />);
    const buttons = document.querySelectorAll('.call-pill-actions .panel-icon-btn');
    expect(buttons).toHaveLength(3);

    fireEvent.click(buttons[0]);
    expect(useCallStore.getState().isMuted).toBe(true);

    fireEvent.click(buttons[1]);
    expect(useCallStore.getState().isVideoOff).toBe(true);

    fireEvent.click(buttons[2]);
    expect(useCallStore.getState().status).toBe('idle');
  });

  it('clicking the target calls onGoToCall with the call server/channel', () => {
    useCallStore.setState({
      status: 'connected', callChannelId: 'c1', callChannelName: 'general', callServerId: 's1', callServerName: 'Alpha',
    });
    useServerStore.setState({ currentServer: { id: 's2' } as never });
    const onGoToCall = vi.fn();
    render(<CallPill variant="stacked" onGoToCall={onGoToCall} />);
    fireEvent.click(document.querySelector('.call-pill-target')!);
    expect(onGoToCall).toHaveBeenCalledWith('s1', 'c1');
  });
});
