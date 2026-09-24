// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
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

// Экран сам перепривязывает srcObject своего локального <video> после смены
// вида (сетка ↔ фокус на себе и т.д.) — читает поток прямо из
// groupCallService, как и useCallStageModel. Реальный сервис здесь не нужен:
// только два геттера потоков, подменяемые тестами ниже.
const fakeService = vi.hoisted(() => ({
  localStreamState: null as unknown,
  screenStreamState: null as unknown,
}));
vi.mock('@/services/groupCall', () => ({ groupCallService: fakeService }));

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
    remoteCameraOff: new Map(),
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
    reattachRemoteStreams: vi.fn(),
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

  it('lays out the grid in two columns for 3 participants, own tile included (no floating PiP)', () => {
    const model = baseModel({ participants: remoteParticipants(2), totalParticipants: 3 });
    render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    expect(document.querySelector('.mcs-grid-cols-2')).not.toBeNull();
    // Своя плитка + 2 удалённых — все обычные ячейки сетки.
    expect(document.querySelectorAll('.mcs-grid > .mcs-grid-cell').length).toBe(3);
    expect(document.querySelector('.mcs-pip')).toBeNull();
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

  // Поток без аудио: useMicLevel плитки тогда ничего не поднимает.
  const videoOnlyStream = () =>
    ({ getAudioTracks: () => [], getVideoTracks: () => [], getTracks: () => [] }) as unknown as MediaStream;

  // VYC-96: собеседник объявил camera_off (например, свернул приложение).
  it('focus-remote: shows the avatar over the video when the focused peer turned the camera off', () => {
    const model = baseModel({
      participants: remoteParticipants(2),
      totalParticipants: 3,
      focusedUserId: 'u2',
      remoteCameraOff: new Map([['u2', true]]),
    });
    render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    expect(document.querySelector('.mcs-focus-main .mcs-focus-avatar')).toBeTruthy();
    expect(document.querySelector('.mcs-focus-video')).toBeTruthy();
  });

  it('focus-remote: no avatar by default, nor while the camera-off peer is sharing', () => {
    const sharing = baseModel({
      participants: remoteParticipants(1),
      totalParticipants: 2,
      focusedUserId: 'u2',
      screenSharers: new Set(['u2']),
      remoteCameraOff: new Map([['u2', true]]),
    });
    render(<MobileCallScreen model={sharing} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    expect(document.querySelector('.mcs-focus-avatar')).toBeNull();
    cleanup();

    const plain = baseModel({ participants: remoteParticipants(1), totalParticipants: 2, focusedUserId: 'u2' });
    render(<MobileCallScreen model={plain} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    expect(document.querySelector('.mcs-focus-avatar')).toBeNull();
  });

  it('grid: a camera-off peer gets the avatar tile, the others keep their video', () => {
    const model = baseModel({
      participants: [participant('u2', { stream: videoOnlyStream() }), participant('u3', { stream: videoOnlyStream() })],
      totalParticipants: 3,
      remoteCameraOff: new Map([['u3', true]]),
    });
    render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
    const remote = [...document.querySelectorAll('.mcs-grid-cell:not(.is-self) .stage-tile')];
    expect(remote.length).toBe(2);
    expect(remote[0].classList.contains('is-camera-off')).toBe(false);
    expect(remote[1].classList.contains('is-camera-off')).toBe(true);
    expect(remote[1].querySelector('.stage-tile-avatar')).toBeTruthy();
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

  describe('grid includes the local tile', () => {
    const renderCount = (total: number) => {
      const model = baseModel({ participants: remoteParticipants(total - 1), totalParticipants: total });
      render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
      return model;
    };

    it('1 participant → solo self-view, exactly one local video', () => {
      const model = renderCount(1);
      expect(document.querySelector('.mcs-grid')).toBeNull();
      expect(document.querySelectorAll('.mcs-body video').length).toBe(1);
      expect(document.querySelector('.mcs-solo video')).toBe(model.localVideoRef.current);
    });

    it.each([
      [2, 1, false],
      [3, 2, false],
      [5, 2, true],
    ])('%i participants → that many grid cells, own tile first (%i columns, scroll=%s)', (total, cols, scroll) => {
      const model = renderCount(total);
      const grid = document.querySelector('.mcs-grid')!;
      expect(grid.classList.contains(`mcs-grid-cols-${cols}`)).toBe(true);
      expect(grid.classList.contains('is-scroll')).toBe(scroll);
      const cells = grid.querySelectorAll(':scope > .mcs-grid-cell');
      expect(cells.length).toBe(total);
      expect(cells[0].classList.contains('is-self')).toBe(true);
      expect(cells[0].querySelector('video')).toBe(model.localVideoRef.current);
      expect(cells[0].querySelector('.stage-name')?.textContent).toBe('anna (вы)');
    });

    it('own tile shows the muted mic, the camera-off avatar and the mirrored class', () => {
      const model = baseModel({ participants: remoteParticipants(1), totalParticipants: 2, isMuted: true, isVideoOff: true });
      render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
      const self = document.querySelector('.mcs-grid-cell.is-self')!;
      expect(self.querySelector('.stage-plate-mic.is-muted')).toBeTruthy();
      expect(self.querySelector('.stage-tile-avatar')).toBeTruthy();
      expect(self.querySelector('.stage-tile.is-camera-off')).toBeTruthy();
      expect(self.querySelector('video')!.classList.contains('is-mirrored')).toBe(true);
    });

    it('tapping a remote grid cell focuses that participant', () => {
      const setFocusedUserId = vi.fn();
      const model = baseModel({ participants: remoteParticipants(2), totalParticipants: 3, setFocusedUserId });
      render(<MobileCallScreen model={model} onBack={vi.fn()} onOpenChat={vi.fn()} onOpenOverflow={vi.fn()} onOpenQuality={vi.fn()} />);
      fireEvent.click(document.querySelectorAll('.mcs-grid-cell')[2]);
      expect(setFocusedUserId).toHaveBeenCalledWith('u3');
    });
  });

  describe('focusing yourself', () => {
    const props = { onBack: vi.fn(), onOpenChat: vi.fn(), onOpenOverflow: vi.fn(), onOpenQuality: vi.fn() };

    it('tapping own tile opens the self focus view: local video main, every remote in the strip, no local thumb', () => {
      const model = baseModel({ participants: remoteParticipants(3), totalParticipants: 4 });
      render(<MobileCallScreen model={model} {...props} />);
      fireEvent.click(document.querySelector('.mcs-grid-cell.is-self')!);
      expect(document.querySelector('.mcs-grid')).toBeNull();
      const main = document.querySelector('.mcs-focus-main video')!;
      expect(main).toBe(model.localVideoRef.current);
      expect(main.classList.contains('is-mirrored')).toBe(true);
      expect(document.querySelector('.mcs-focus-name')?.textContent).toBe('anna (вы)');
      const thumbs = document.querySelectorAll('.mcs-focus-thumbs .stage-thumb');
      expect(thumbs.length).toBe(3);
      expect([...thumbs].map((el) => el.getAttribute('title'))).toEqual(['u2', 'u3', 'u4']);
      // Удалённые <video> остались смонтированы — их аудио продолжает играть.
      expect(document.querySelectorAll('.mcs-focus-thumbs video').length).toBe(3);
    });

    it('re-binds remote streams on every layout change that recreates the tiles (audio comes from those <video>)', () => {
      const model = baseModel({ participants: remoteParticipants(2), totalParticipants: 3 });
      render(<MobileCallScreen model={model} {...props} />);
      const reattach = model.reattachRemoteStreams as ReturnType<typeof vi.fn>;
      reattach.mockClear();
      fireEvent.click(document.querySelector('.mcs-grid-cell.is-self')!);
      expect(reattach).toHaveBeenCalledTimes(1);
      fireEvent.click(document.querySelector('.mcs-focus-back')!);
      expect(reattach).toHaveBeenCalledTimes(2);
    });

    it('tapping the main video or the grid button returns to the grid', () => {
      const model = baseModel({ participants: remoteParticipants(1), totalParticipants: 2 });
      render(<MobileCallScreen model={model} {...props} />);
      fireEvent.click(document.querySelector('.mcs-grid-cell.is-self')!);
      fireEvent.click(document.querySelector('.mcs-focus-video')!);
      expect(document.querySelector('.mcs-grid')).toBeTruthy();
      fireEvent.click(document.querySelector('.mcs-grid-cell.is-self')!);
      fireEvent.click(document.querySelector('.mcs-focus-back')!);
      expect(document.querySelector('.mcs-grid')).toBeTruthy();
      expect(model.setFocusedUserId).not.toHaveBeenCalled();
    });

    it('tapping a remote thumbnail from self focus switches to that participant', () => {
      const setFocusedUserId = vi.fn();
      const model = baseModel({ participants: remoteParticipants(2), totalParticipants: 3, setFocusedUserId });
      const { rerender } = render(<MobileCallScreen model={model} {...props} />);
      fireEvent.click(document.querySelector('.mcs-grid-cell.is-self')!);
      fireEvent.click(document.querySelectorAll('.mcs-focus-thumbs .stage-thumb')[1]);
      expect(setFocusedUserId).toHaveBeenCalledWith('u3');
      // Модель отражает новый фокус — теперь главное видео чужое, а своя
      // миниатюра вернулась в ленту первой.
      rerender(<MobileCallScreen model={{ ...model, focusedUserId: 'u3' }} {...props} />);
      expect(document.querySelector('.mcs-focus-main video')).not.toBe(model.localVideoRef.current);
      expect(document.querySelector('.mcs-focus-name')?.textContent).toBe('u3');
      expect(document.querySelectorAll('.mcs-focus-thumbs .stage-thumb').length).toBe(3);
      // И после ухода с удалённого фокуса локальный фокус не «воскресает».
      rerender(<MobileCallScreen model={{ ...model, focusedUserId: null }} {...props} />);
      expect(document.querySelector('.mcs-grid')).toBeTruthy();
    });

    it('the local thumbnail in a remote focus view switches to self focus', () => {
      const setFocusedUserId = vi.fn();
      const model = baseModel({ participants: remoteParticipants(1), totalParticipants: 2, focusedUserId: 'u2', setFocusedUserId });
      const { rerender } = render(<MobileCallScreen model={model} {...props} />);
      fireEvent.click(document.querySelector('.mcs-focus-thumbs .stage-thumb')!);
      expect(setFocusedUserId).toHaveBeenCalledWith(null);
      rerender(<MobileCallScreen model={{ ...model, focusedUserId: null }} {...props} />);
      expect(document.querySelector('.mcs-focus-main video')).toBe(model.localVideoRef.current);
    });

    it('self focus does not leak past the end of the call', () => {
      const model = baseModel({ participants: remoteParticipants(1), totalParticipants: 2 });
      const { rerender } = render(<MobileCallScreen model={model} {...props} />);
      fireEvent.click(document.querySelector('.mcs-grid-cell.is-self')!);
      rerender(<MobileCallScreen model={{ ...model, isInGroupCall: false }} {...props} />);
      rerender(<MobileCallScreen model={model} {...props} />);
      expect(document.querySelector('.mcs-grid')).toBeTruthy();
      expect(document.querySelector('.mcs-focus')).toBeNull();
    });
  });

  describe('local srcObject re-binding', () => {
    const props = { onBack: vi.fn(), onOpenChat: vi.fn(), onOpenOverflow: vi.fn(), onOpenQuality: vi.fn() };
    const camera = { id: 'camera' } as unknown as MediaStream;
    const screenStream = { id: 'screen' } as unknown as MediaStream;
    afterEach(() => {
      fakeService.localStreamState = null;
      fakeService.screenStreamState = null;
    });

    it('the recreated local <video> gets the stream back after grid ↔ focus transitions', () => {
      fakeService.localStreamState = camera;
      const model = baseModel({ participants: remoteParticipants(2), totalParticipants: 3 });
      const { rerender } = render(<MobileCallScreen model={model} {...props} />);
      const gridVideo = model.localVideoRef.current!;
      expect(gridVideo.srcObject).toBe(camera);

      fireEvent.click(document.querySelector('.mcs-grid-cell.is-self')!);
      const focusVideo = model.localVideoRef.current!;
      expect(focusVideo).not.toBe(gridVideo);
      expect(focusVideo.srcObject).toBe(camera);

      fireEvent.click(document.querySelector('.mcs-focus-back')!);
      expect(model.localVideoRef.current).not.toBe(focusVideo);
      expect(model.localVideoRef.current!.srcObject).toBe(camera);

      // Удалённый фокус — локальная миниатюра в ленте, и обратно в сетку.
      rerender(<MobileCallScreen model={{ ...model, focusedUserId: 'u2' }} {...props} />);
      expect(model.localVideoRef.current!.closest('.mcs-focus-thumbs')).toBeTruthy();
      expect(model.localVideoRef.current!.srcObject).toBe(camera);
      rerender(<MobileCallScreen model={{ ...model, focusedUserId: null }} {...props} />);
      expect(model.localVideoRef.current!.closest('.mcs-grid')).toBeTruthy();
      expect(model.localVideoRef.current!.srcObject).toBe(camera);
    });

    it('uses the screen stream while sharing and does not reassign an equal srcObject', () => {
      fakeService.localStreamState = camera;
      fakeService.screenStreamState = screenStream;
      const model = baseModel({ participants: remoteParticipants(1), totalParticipants: 2, isScreenSharing: true });
      const { rerender } = render(<MobileCallScreen model={model} {...props} />);
      const el = model.localVideoRef.current!;
      expect(el.srcObject).toBe(screenStream);
      expect(el.classList.contains('is-screen')).toBe(true);
      let writes = 0;
      const desc = { configurable: true, get: () => screenStream, set: () => { writes += 1; } };
      Object.defineProperty(el, 'srcObject', desc);
      rerender(<MobileCallScreen model={{ ...model, micLevel: 0.5 }} {...props} />);
      expect(writes).toBe(0);
    });
  });

  describe('fullscreen button on the focus view', () => {
    const props = { onBack: vi.fn(), onOpenChat: vi.fn(), onOpenOverflow: vi.fn(), onOpenQuality: vi.fn() };
    type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

    it('requests fullscreen on .mcs-focus-main (not the whole .mcs-focus), incl. while watching a share', () => {
      const request = vi.mocked(Element.prototype.requestFullscreen);
      const model = baseModel({
        participants: remoteParticipants(1),
        totalParticipants: 2,
        focusedUserId: 'u2',
        screenSharers: new Set(['u2']),
      });
      render(<MobileCallScreen model={model} {...props} />);
      request.mockClear();
      const btn = byLabel('На весь экран')!;
      expect(btn.closest('.mcs-focus-main')).toBeTruthy();
      fireEvent.click(btn);
      expect(request).toHaveBeenCalledOnce();
      expect(request.mock.contexts[0]).toBe(document.querySelector('.mcs-focus-main'));
    });

    it('is also available in self focus', () => {
      const model = baseModel({ participants: remoteParticipants(1), totalParticipants: 2 });
      render(<MobileCallScreen model={model} {...props} />);
      fireEvent.click(document.querySelector('.mcs-grid-cell.is-self')!);
      expect(byLabel('На весь экран')).toBeTruthy();
    });

    it('falls back to the video\'s webkitEnterFullscreen when requestFullscreen is missing (iPhone)', () => {
      const original = Element.prototype.requestFullscreen;
      // @ts-expect-error — эмулируем iPhone Safari без Fullscreen API у элементов
      delete Element.prototype.requestFullscreen;
      try {
        const model = baseModel({ participants: remoteParticipants(1), totalParticipants: 2, focusedUserId: 'u2' });
        render(<MobileCallScreen model={model} {...props} />);
        const video = model.focusedVideoRef.current as WebkitVideo;
        video.webkitEnterFullscreen = vi.fn();
        fireEvent.click(byLabel('На весь экран')!);
        expect(video.webkitEnterFullscreen).toHaveBeenCalledOnce();
      } finally {
        Element.prototype.requestFullscreen = original;
      }
    });

    it('reflects fullscreenchange and exits on the next tap', () => {
      const exit = vi.fn().mockResolvedValue(undefined);
      document.exitFullscreen = exit;
      const model = baseModel({ participants: remoteParticipants(1), totalParticipants: 2, focusedUserId: 'u2' });
      render(<MobileCallScreen model={model} {...props} />);
      const main = document.querySelector('.mcs-focus-main')!;
      Object.defineProperty(document, 'fullscreenElement', { value: main, configurable: true, writable: true });
      try {
        act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
        const btn = byLabel('Выйти из полноэкранного режима')!;
        expect(btn).toBeTruthy();
        fireEvent.click(btn);
        expect(exit).toHaveBeenCalledOnce();
      } finally {
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true, writable: true });
      }
    });
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
