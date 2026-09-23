// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MobileCallScreen } from '@/mobile/screens/MobileCallScreen';
import type { CallStageModel } from '@/components/useCallStageModel';
import type { RemoteParticipant } from '@/stores/callStore';
import { stubBrowser, participant } from '@/components/__tests__/callHarness';

// Тот же приём для useAudioOutput — реальный хук зависит от
// navigator.mediaDevices.enumerateDevices()/setSinkId feature-detection,
// которые здесь тестировать незачем (у хука свой файл тестов); экран
// проверяется только на то, что он корректно рендерит/вызывает то, что хук
// возвращает.
vi.mock('@/mobile/hooks/useAudioOutput', () => ({ useAudioOutput: vi.fn() }));

import { useAudioOutput } from '@/mobile/hooks/useAudioOutput';

// I1 fix (task-final-fix-report.md): MobileCallScreen no longer calls
// useCallStageModel() itself — CallScreen (renderScreen.tsx) owns the one
// live instance and passes it down as a `model` prop, so the «⋯»/quality
// sheets it also feeds never go stale. The component under test here is a
// pure consumer of that prop, so the test model is just a plain object built
// per test, not a mocked hook return value.
function baseModel(over: Partial<CallStageModel> = {}): CallStageModel {
  return {
    user: { id: 'u1', username: 'anna', avatar_url: null } as never,
    isGuestMode: false,
    isInGroupCall: true,
    guestLinksEnabled: false,
    callChannelId: 'c1',
    callChannelName: 'general',
    totalParticipants: 1,
    nameFor: (id: string) => id,

    status: 'connected',
    isReconnecting: false,
    isMuted: false,
    isMicAvailable: true,
    isVideoOff: true,
    isScreenSharing: false,
    participants: [],
    screenSharers: new Set(),
    remoteScreenStreams: new Map(),
    remoteMicMuted: new Map(),
    qualityByUser: {},
    localQuality: undefined,
    focusedUserId: null,
    setFocusedUserId: vi.fn(),
    bannerDismissed: false,
    dismissBanner: vi.fn(),
    participantVolumes: {},
    volumePopoverUserId: null,
    toggleVolumePopover: vi.fn(),
    closeVolumePopover: vi.fn(),
    onVolumeChange: vi.fn(),

    localVideoRef: { current: null },
    focusedVideoRef: { current: null },
    setRemoteVideoRef: vi.fn(),
    stageRef: { current: null },
    screenShareMainRef: { current: null },

    fullscreenTarget: null,
    stageFullscreenActive: false,
    focusFullscreenActive: false,
    fullscreenEl: null,
    handleStageFullscreen: vi.fn(async () => {}),
    handleFocusFullscreen: vi.fn(async () => {}),

    handleToggleMute: vi.fn(),
    handleToggleVideo: vi.fn(),
    handleToggleScreenShare: vi.fn(async () => {}),
    handleSelectSource: vi.fn(),
    handleSelectQuality: vi.fn(async () => {}),
    handleLeaveGroupCall: vi.fn(),

    screenSources: [],
    showSourcePickerModal: false,
    closeSourcePicker: vi.fn(),
    showQualityPicker: false,
    closeQualityPicker: vi.fn(),

    invitePosition: null,
    inviteBtnRef: { current: null },
    toggleInvitePopover: vi.fn(),
    closeInvitePopover: vi.fn(),

    stageError: null,
    setStageError: vi.fn(),

    micLevel: 0,

    applySinkId: vi.fn(),

    ...over,
  };
}

function mockAudioOutput(over: Partial<ReturnType<typeof useAudioOutput>> = {}) {
  vi.mocked(useAudioOutput).mockReturnValue({ supported: false, cycle: vi.fn(), currentLabel: '', ...over });
}

const byLabel = (label: string) =>
  [...document.querySelectorAll('[aria-label]')].find((el) => el.getAttribute('aria-label') === label) as HTMLElement | undefined;

beforeAll(stubBrowser);
// Unsupported by default so the speaker button stays out of every test that
// doesn't explicitly opt into it — matches the panel-order assumptions the
// other tests below (index-based clicks, "exactly 5 buttons") already make.
beforeEach(() => mockAudioOutput());
afterEach(cleanup);

const remoteParticipants = (n: number): RemoteParticipant[] =>
  Array.from({ length: n }, (_, i) => participant(`u${i + 2}`));

describe('MobileCallScreen', () => {
  it('renders nothing outside a group call', () => {
    const model = baseModel({ isInGroupCall: false });
    const { container } = render(
      <MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('lays out the grid in two columns for 3 participants', () => {
    const model = baseModel({ participants: remoteParticipants(2), totalParticipants: 3 });
    render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    expect(document.querySelector('.mcs-grid-cols-2')).not.toBeNull();
    // Локальный PiP + 2 удалённых участника
    expect(document.querySelectorAll('.mcs-pip').length).toBe(1);
  });

  it('renders the focused-view video when a participant is focused', () => {
    const model = baseModel({ participants: remoteParticipants(1), totalParticipants: 2, focusedUserId: 'u2' });
    render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    expect(document.querySelector('.mcs-focus-video')).not.toBeNull();
    expect(document.querySelector('.mcs-grid')).toBeNull();
  });

  it('shows the focused participant\'s name label in the focused view', () => {
    const model = baseModel({
      participants: remoteParticipants(1),
      totalParticipants: 2,
      focusedUserId: 'u2',
      nameFor: (id: string) => (id === 'u2' ? 'Boris' : id),
    });
    render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    expect(document.querySelector('.mcs-focus-name')?.textContent).toBe('Boris');
  });

  it('renders a thumbnail strip with everyone still visible in the focused view (C1: audio plays from the thumbnail element)', () => {
    const model = baseModel({ participants: remoteParticipants(2), totalParticipants: 3, focusedUserId: 'u2' });
    render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    expect(document.querySelector('.mcs-focus-thumbs')).not.toBeNull();
    // Локальная миниатюра + 2 удалённых — все остаются смонтированы
    // (setRemoteVideoRef больше не снимается на focus), не только фокусный.
    expect(document.querySelectorAll('.mcs-focus-thumbs .stage-thumb').length).toBe(3);
  });

  it('tapping the focused video returns to the grid (M4: single tap exits focus when not zoomed)', () => {
    const setFocusedUserId = vi.fn();
    const model = baseModel({
      participants: remoteParticipants(1),
      totalParticipants: 2,
      focusedUserId: 'u2',
      setFocusedUserId,
    });
    render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    fireEvent.click(document.querySelector('.mcs-focus-video')!);
    expect(setFocusedUserId).toHaveBeenCalledWith(null);
  });

  it('renders full-screen solo self-view (not the floating PiP) when there are no remote participants', () => {
    const model = baseModel({ participants: [], totalParticipants: 1 });
    render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    expect(document.querySelector('.mcs-solo')).not.toBeNull();
    expect(document.querySelector('.mcs-pip')).toBeNull();
    expect(document.querySelector('.mcs-grid')).toBeNull();
  });

  it('the collapse button calls onBack', () => {
    const model = baseModel();
    const onBack = vi.fn();
    render(<MobileCallScreen model={model} onBack={onBack} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    fireEvent.click(document.querySelector('.mcs-collapse-btn')!);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('omits the collapse button when onBack is not passed (guest shell: collapsing would end the guest session)', () => {
    const model = baseModel();
    render(<MobileCallScreen model={model} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    expect(document.querySelector('.mcs-collapse-btn')).toBeNull();
    expect(byLabel('Свернуть звонок')).toBeUndefined();
  });

  describe('chatUnreadCount badge', () => {
    const renderWith = (chatUnreadCount?: number) => render(
      <MobileCallScreen
        model={baseModel()}
        onBack={vi.fn()}
        onOpenChat={vi.fn()}
        onOpenOverflow={vi.fn()}
        onOpenQuality={vi.fn()}
        chatUnreadCount={chatUnreadCount}
      />,
    );

    it('renders the count on the chat button', () => {
      renderWith(3);
      const badge = byLabel('Открыть чат')!.querySelector('.mcs-chat-badge');
      expect(badge?.textContent).toBe('3');
    });

    it('shows 99 as-is and caps anything above at "99+"', () => {
      renderWith(99);
      expect(document.querySelector('.mcs-chat-badge')?.textContent).toBe('99');
      cleanup();
      renderWith(100);
      expect(document.querySelector('.mcs-chat-badge')?.textContent).toBe('99+');
    });

    it('is absent when the prop is omitted (authenticated CallScreen)', () => {
      renderWith(undefined);
      expect(document.querySelector('.mcs-chat-badge')).toBeNull();
    });

    it('is absent at 0', () => {
      renderWith(0);
      expect(document.querySelector('.mcs-chat-badge')).toBeNull();
    });
  });

  it('the participants button calls onOpenParticipants when the prop is passed', () => {
    const onOpenParticipants = vi.fn();
    render(
      <MobileCallScreen
        model={baseModel()}
        onBack={vi.fn()}
        onOpenChat={vi.fn()}
        onOpenOverflow={vi.fn()}
        onOpenQuality={vi.fn()}
        onOpenParticipants={onOpenParticipants}
      />,
    );
    fireEvent.click(byLabel('Участники')!);
    expect(onOpenParticipants).toHaveBeenCalledOnce();
  });

  it('omits the participants button when onOpenParticipants is not passed (authenticated CallScreen)', () => {
    render(<MobileCallScreen model={baseModel()} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    expect(document.querySelector('.mcs-participants-btn')).toBeNull();
    expect(byLabel('Участники')).toBeUndefined();
  });

  it('the overflow ("...") button calls onOpenOverflow with no arguments', () => {
    const model = baseModel({ totalParticipants: 4 });
    const onOpenOverflow = vi.fn();
    render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={onOpenOverflow} onOpenQuality={vi.fn()} />);
    // Panel order is mic / camera / chat / overflow ("...") / leave.
    fireEvent.click(document.querySelectorAll('.mcs-panel-btn')[3]);
    expect(onOpenOverflow).toHaveBeenCalledWith();
  });

  it('the header quality indicator calls onOpenQuality (not onOpenOverflow) with no arguments', () => {
    const model = baseModel({ totalParticipants: 4 });
    const onOpenOverflow = vi.fn();
    const onOpenQuality = vi.fn();
    render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={onOpenOverflow} onOpenQuality={onOpenQuality} />);
    fireEvent.click(document.querySelector('.mcs-quality-btn')!);
    expect(onOpenQuality).toHaveBeenCalledWith();
    expect(onOpenOverflow).not.toHaveBeenCalled();
  });

  it('the chat button calls onOpenChat', () => {
    const model = baseModel();
    const onOpenChat = vi.fn();
    render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={onOpenChat} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    fireEvent.click(byLabel('Открыть чат')!);
    expect(onOpenChat).toHaveBeenCalledOnce();
  });

  it('shows the speaker button and calls cycle() when audio-output switching is supported', () => {
    const cycle = vi.fn();
    mockAudioOutput({ supported: true, cycle, currentLabel: 'Динамик' });
    const model = baseModel();
    render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    // mic, camera, speaker, chat, overflow, leave — 6 with the speaker button in.
    expect(document.querySelectorAll('.mcs-panel-btn').length).toBe(6);
    fireEvent.click(byLabel('Динамик')!);
    expect(cycle).toHaveBeenCalledOnce();
  });

  it('hides the speaker button when audio-output switching is unsupported', () => {
    mockAudioOutput({ supported: false });
    const model = baseModel();
    render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    // mic, camera, chat, overflow, leave — exactly 5, no speaker button.
    expect(document.querySelectorAll('.mcs-panel-btn').length).toBe(5);
  });

  it('shows the reconnecting banner when the call is reconnecting', () => {
    const model = baseModel({ isReconnecting: true });
    render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    expect(document.querySelector('.mcs-reconnecting')?.textContent).toBe('Переподключение…');
  });

  it('does not show the reconnecting banner otherwise', () => {
    const model = baseModel({ isReconnecting: false });
    render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    expect(document.querySelector('.mcs-reconnecting')).toBeNull();
  });

  it('leave button calls handleLeaveGroupCall', () => {
    const handleLeaveGroupCall = vi.fn();
    const model = baseModel({ handleLeaveGroupCall });
    render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    fireEvent.click(document.querySelector('.mcs-panel-btn.is-danger')!);
    expect(handleLeaveGroupCall).toHaveBeenCalledOnce();
  });

  it('mic button toggles mute and reflects the muted state', () => {
    const handleToggleMute = vi.fn();
    const model = baseModel({ isMuted: true, handleToggleMute });
    render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    // Muted → aria-label offers to turn the mic back on.
    const btn = byLabel('Включить микрофон')!;
    expect(btn.classList.contains('is-off')).toBe(true);
    fireEvent.click(btn);
    expect(handleToggleMute).toHaveBeenCalledOnce();
  });

  it('hides the guest lobby toast for guests', () => {
    const model = baseModel({ isGuestMode: true });
    render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    expect(document.querySelector('.guest-lobby-toasts')).toBeNull();
  });
});
