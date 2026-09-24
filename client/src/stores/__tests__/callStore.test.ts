import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

vi.mock('@/services/groupCall', () => ({
  groupCallService: {
    isInGroupCallState: false,
    currentRoomIdState: '',
    isMicrophoneAvailable: true,
    isScreenSharing: false,
    lastMediaWarningState: null as string | null,
    localStreamState: null as unknown,
    init: vi.fn(),
    joinGroupCall: vi.fn(),
    leaveGroupCall: vi.fn(),
    toggleMuteAudio: vi.fn(() => true),
    toggleMuteVideo: vi.fn(() => true),
    watchShare: vi.fn(),
    unwatchShare: vi.fn(),
  },
}));
vi.mock('@/services/websocket', () => ({ wsService: { send: vi.fn(), on: vi.fn(() => () => {}) } }));
vi.mock('@/services/audio', () => ({
  audioService: { playUserJoined: vi.fn(), playUserLeft: vi.fn() },
}));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { useCallStore, initCallBridge, CAMERA_REANNOUNCE_DEBOUNCE_MS } from '@/stores/callStore';
import { groupCallService } from '@/services/groupCall';
import type { GroupCallCallbacks } from '@/services/groupCall';
import { wsService } from '@/services/websocket';
import { audioService } from '@/services/audio';

const gc = groupCallService as unknown as {
  isInGroupCallState: boolean;
  currentRoomIdState: string;
  isMicrophoneAvailable: boolean;
  isScreenSharing: boolean;
  lastMediaWarningState: string | null;
  localStreamState: unknown;
  init: ReturnType<typeof vi.fn>;
  joinGroupCall: ReturnType<typeof vi.fn>;
  leaveGroupCall: ReturnType<typeof vi.fn>;
};

const opts = {
  channelId: 'ch-1',
  channelName: 'общий',
  serverId: 'srv-1',
  serverName: 'Мой сервер',
  userId: 'u-1',
  userName: 'Аня',
};

const sent = () => (wsService.send as ReturnType<typeof vi.fn>).mock.calls;

describe('callStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gc.isInGroupCallState = false;
    gc.currentRoomIdState = '';
    gc.isMicrophoneAvailable = true;
    gc.isScreenSharing = false;
    gc.lastMediaWarningState = null;
    gc.localStreamState = null;
    // joinGroupCall выставляет комнату так же, как настоящий сервис
    gc.joinGroupCall.mockImplementation(async (roomId: string) => {
      gc.currentRoomIdState = roomId;
      gc.isInGroupCallState = true;
      return false;
    });
    useCallStore.getState().reset();
  });

  it('join выставляет канал звонка и шлёт voice_joined один раз', async () => {
    await useCallStore.getState().join(opts);

    const state = useCallStore.getState();
    expect(state.callChannelId).toBe('ch-1');
    expect(state.callChannelName).toBe('общий');
    expect(state.callServerId).toBe('srv-1');
    expect(state.status).toBe('connected');
    expect(sent().filter(([type]) => type === 'voice_joined')).toHaveLength(1);
    expect(audioService.playUserJoined).toHaveBeenCalledTimes(1);
  });

  it('join шлёт voice_call_ring только когда мы первые в комнате', async () => {
    gc.joinGroupCall.mockImplementation(async (roomId: string) => {
      gc.currentRoomIdState = roomId;
      gc.isInGroupCallState = true;
      return true; // мы первые
    });

    await useCallStore.getState().join(opts);

    const ring = sent().find(([type]) => type === 'voice_call_ring');
    expect(ring).toBeDefined();
    expect(ring?.[1]).toMatchObject({
      channel_id: 'ch-1',
      server_id: 'srv-1',
      caller_id: 'u-1',
      caller_name: 'Аня',
      channel_name: 'общий',
    });
  });

  it('join не шлёт voice_call_ring, когда в комнате уже кто-то есть', async () => {
    await useCallStore.getState().join(opts);
    expect(sent().some(([type]) => type === 'voice_call_ring')).toBe(false);
  });

  it('повторный join в ту же комнату — no-op', async () => {
    await useCallStore.getState().join(opts);
    vi.clearAllMocks();

    await useCallStore.getState().join(opts);

    expect(gc.joinGroupCall).not.toHaveBeenCalled();
    expect(sent()).toHaveLength(0);
    expect(audioService.playUserJoined).not.toHaveBeenCalled();
  });

  it('join во время joining игнорируется', async () => {
    let release: (v: boolean) => void = () => {};
    gc.joinGroupCall.mockImplementation(
      () => new Promise<boolean>((resolve) => { release = resolve; })
    );

    const first = useCallStore.getState().join(opts);
    expect(useCallStore.getState().status).toBe('joining');

    await useCallStore.getState().join({ ...opts, channelId: 'ch-2' });
    expect(gc.joinGroupCall).toHaveBeenCalledTimes(1);

    release(false);
    await first;
  });

  it('микрофон недоступен — стартуем в муте и объявляем mic_muted', async () => {
    gc.isMicrophoneAvailable = false;

    await useCallStore.getState().join(opts);

    expect(useCallStore.getState().isMuted).toBe(true);
    expect(useCallStore.getState().isMicAvailable).toBe(false);
    expect(sent().some(([type]) => type === 'mic_muted')).toBe(true);
  });

  it('join переносит lastMediaWarningState сервиса в mediaWarning стора', async () => {
    gc.lastMediaWarningState = 'Доступ к камере и/или микрофону запрещён в системе.';

    await useCallStore.getState().join(opts);

    expect(useCallStore.getState().mediaWarning).toBe(
      'Доступ к камере и/или микрофону запрещён в системе.',
    );
  });

  it('clearMediaWarning сбрасывает mediaWarning в null', async () => {
    gc.lastMediaWarningState = 'Не удалось получить доступ к камере и микрофону.';
    await useCallStore.getState().join(opts);
    expect(useCallStore.getState().mediaWarning).not.toBeNull();

    useCallStore.getState().clearMediaWarning();

    expect(useCallStore.getState().mediaWarning).toBeNull();
  });

  it('leave шлёт voice_left и voice_call_cancel и сбрасывает стор', async () => {
    await useCallStore.getState().join(opts);
    vi.clearAllMocks();

    useCallStore.getState().leave();

    expect(sent().some(([type]) => type === 'voice_left')).toBe(true);
    expect(sent().some(([type]) => type === 'voice_call_cancel')).toBe(true);
    expect(audioService.playUserLeft).toHaveBeenCalledTimes(1);
    expect(gc.leaveGroupCall).toHaveBeenCalledTimes(1);
    expect(useCallStore.getState().callChannelId).toBeNull();
    expect(useCallStore.getState().status).toBe('idle');
  });

  it('reset сбрасывает стор молча — без звука и без WS', async () => {
    await useCallStore.getState().join(opts);
    vi.clearAllMocks();

    useCallStore.getState().reset();

    expect(useCallStore.getState().status).toBe('idle');
    expect(useCallStore.getState().callChannelId).toBeNull();
    expect(sent()).toHaveLength(0);
    expect(audioService.playUserLeft).not.toHaveBeenCalled();
  });

  describe('initCallBridge', () => {
    // Мост подписывается один раз на весь модуль, поэтому счётчик и сам набор
    // колбэков снимаются здесь — beforeEach выше делает vi.clearAllMocks(),
    // после которого init.mock.calls уже пуст.
    let callbacks: GroupCallCallbacks;
    let initCallCount = 0;
    // Входящие WS-события звонка тоже подписываются здесь, а не в сцене:
    // сцена размонтируется при уходе в другой канал.
    const wsHandlers = new Map<string, (payload: unknown) => void>();

    beforeAll(() => {
      initCallBridge();
      initCallBridge();
      initCallCount = gc.init.mock.calls.length;
      callbacks = gc.init.mock.calls[0][0] as GroupCallCallbacks;
      for (const [type, handler] of (wsService.on as ReturnType<typeof vi.fn>).mock.calls) {
        wsHandlers.set(type as string, handler as (payload: unknown) => void);
      }
    });

    it('подписывается на сервис ровно один раз при повторных вызовах', () => {
      expect(initCallCount).toBe(1);
    });

    it('onPeerJoined добавляет участника, onPeerLeft убирает', () => {
      callbacks.onPeerJoined('u-2', 'live');
      expect(useCallStore.getState().participants).toEqual([{ userId: 'u-2', stream: null }]);

      callbacks.onPeerLeft('u-2');
      expect(useCallStore.getState().participants).toEqual([]);
    });

    it('onReconnecting и onReconnected двигают только status', async () => {
      await useCallStore.getState().join(opts);

      callbacks.onReconnecting?.();
      expect(useCallStore.getState().status).toBe('reconnecting');
      expect(useCallStore.getState().callChannelId).toBe('ch-1');

      callbacks.onReconnected?.();
      expect(useCallStore.getState().status).toBe('connected');
      expect(useCallStore.getState().callChannelId).toBe('ch-1');
    });

    it('onCallEnded сбрасывает стор молча', async () => {
      await useCallStore.getState().join(opts);
      vi.clearAllMocks();

      callbacks.onCallEnded();

      expect(useCallStore.getState().status).toBe('idle');
      expect(useCallStore.getState().callChannelId).toBeNull();
      expect(audioService.playUserLeft).not.toHaveBeenCalled();
    });

    it('onSharingPeers объединяется с уже известными шарерами, не затирая их', () => {
      callbacks.onSharingPeers?.(['u-2']);
      callbacks.onSharingPeers?.(['u-3']);
      expect([...useCallStore.getState().screenSharers].sort()).toEqual(['u-2', 'u-3']);
    });

    it('подписан на входящие WS-события звонка', () => {
      expect([...wsHandlers.keys()].sort()).toEqual([
        'camera_off',
        'camera_on',
        'connection_quality',
        // Гости звонка доходят до участников только этими событиями: в хабе
        // гостя нет (2026-09-17-guest-call-link-design.md).
        'guest_links_changed',
        'guest_lobby_request',
        'guest_lobby_resolved',
        'guest_participants',
        'mic_muted',
        'mic_unmuted',
        'screen_share_started',
        'screen_share_stopped',
      ]);
    });

    it('mic_muted/mic_unmuted обновляют remoteMicMuted участника звонка', async () => {
      await useCallStore.getState().join(opts);
      callbacks.onPeerJoined('u-2', 'live');

      wsHandlers.get('mic_muted')!({ user_id: 'u-2' });
      expect(useCallStore.getState().remoteMicMuted.get('u-2')).toBe(true);

      wsHandlers.get('mic_unmuted')!({ user_id: 'u-2' });
      expect(useCallStore.getState().remoteMicMuted.get('u-2')).toBe(false);

      useCallStore.getState().reset();
    });

    // ── VYC-96: камера собеседника ──
    it('camera_off/camera_on обновляют remoteCameraOff участника звонка', async () => {
      await useCallStore.getState().join(opts);
      callbacks.onPeerJoined('u-2', 'live');

      wsHandlers.get('camera_off')!({ user_id: 'u-2' });
      expect(useCallStore.getState().remoteCameraOff.get('u-2')).toBe(true);

      wsHandlers.get('camera_on')!({ user_id: 'u-2' });
      expect(useCallStore.getState().remoteCameraOff.get('u-2') ?? false).toBe(false);

      useCallStore.getState().reset();
    });

    it('camera_off от себя, от не-участника и вне звонка игнорируется', async () => {
      wsHandlers.get('camera_off')!({ user_id: 'u-2' });
      expect(useCallStore.getState().remoteCameraOff.size).toBe(0);

      await useCallStore.getState().join(opts);
      useCallStore.setState({ guestSelf: { id: 'me', username: 'я' } });
      wsHandlers.get('camera_off')!({ user_id: 'me' });
      wsHandlers.get('camera_off')!({ user_id: 'stranger' });
      expect(useCallStore.getState().remoteCameraOff.size).toBe(0);

      useCallStore.getState().reset();
    });

    it('уход участника чистит remoteCameraOff, реконнект сохраняет, snapshot отсеивает ушедших', async () => {
      await useCallStore.getState().join(opts);
      callbacks.onPeerJoined('u-2', 'live');
      callbacks.onPeerJoined('u-3', 'live');
      wsHandlers.get('camera_off')!({ user_id: 'u-2' });
      wsHandlers.get('camera_off')!({ user_id: 'u-3' });

      callbacks.onPeerLeft('u-2');
      expect(useCallStore.getState().remoteCameraOff.has('u-2')).toBe(false);
      expect(useCallStore.getState().remoteCameraOff.get('u-3')).toBe(true);

      // Resume: остальные нас не теряли и свою камеру заново не объявят.
      callbacks.onReconnecting?.();
      expect(useCallStore.getState().remoteCameraOff.get('u-3')).toBe(true);

      wsHandlers.get('camera_off')!({ user_id: 'u-3' }); // (участников пока нет — игнор)
      callbacks.onPeerSnapshot?.(['u-4']); // u-3 ушёл, пока мы были в grace
      expect(useCallStore.getState().remoteCameraOff.has('u-3')).toBe(false);

      useCallStore.getState().reset();
      expect(useCallStore.getState().remoteCameraOff.size).toBe(0);
    });

    it('после реконнекта (resume) своё состояние мика и камеры объявляется заново, одним разом', async () => {
      vi.useFakeTimers();
      try {
        await useCallStore.getState().join(opts);
        callbacks.onPeerJoined('u-2', 'live');
        vi.advanceTimersByTime(CAMERA_REANNOUNCE_DEBOUNCE_MS);
        vi.clearAllMocks();

        callbacks.onReconnecting?.();
        callbacks.onPeerSnapshot?.(['u-2']);
        callbacks.onReconnected?.();
        expect(sent().some(([type]) => type === 'camera_off')).toBe(false);

        vi.advanceTimersByTime(CAMERA_REANNOUNCE_DEBOUNCE_MS);
        const types = sent().map(([type]) => type).filter((t) => /^(mic|camera)_/.test(t as string));
        expect(types).toEqual(['mic_unmuted', 'camera_off']);
      } finally {
        useCallStore.getState().reset();
        vi.useRealTimers();
      }
    });

    it('leave и reset отменяют отложенное объявление камеры', async () => {
      vi.useFakeTimers();
      try {
        await useCallStore.getState().join(opts);
        callbacks.onPeerJoined('u-2', 'live');
        expect(vi.getTimerCount()).toBe(1);
        useCallStore.getState().leave();
        expect(vi.getTimerCount()).toBe(0);

        gc.isInGroupCallState = false; // сервис после leaveGroupCall
        gc.currentRoomIdState = '';
        await useCallStore.getState().join(opts);
        callbacks.onReconnected?.();
        expect(vi.getTimerCount()).toBe(1);
        useCallStore.getState().reset();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('вход объявляет camera_off, смена isVideoOff — camera_on/camera_off', async () => {
      gc.localStreamState = { getVideoTracks: () => [{ enabled: true }] };
      await useCallStore.getState().join(opts);
      const camera = () => sent().filter(([type]) => type === 'camera_off' || type === 'camera_on').map(([type]) => type);
      expect(camera()).toEqual(['camera_off']);

      // Кнопка сцены / useBackgroundCamera / гость — все пишут isVideoOff в стор.
      useCallStore.setState({ isVideoOff: false });
      expect(camera()).toEqual(['camera_off', 'camera_on']);

      useCallStore.setState({ isVideoOff: true });
      expect(camera()).toEqual(['camera_off', 'camera_on', 'camera_off']);

      // Выход сбрасывает стор (isVideoOff → true) — объявлять уже некому.
      useCallStore.setState({ isVideoOff: false });
      vi.clearAllMocks();
      useCallStore.getState().reset();
      expect(camera()).toEqual([]);
    });

    it('без видеотрека камера объявляется выключенной, даже если isVideoOff=false', async () => {
      gc.localStreamState = { getVideoTracks: () => [] };
      await useCallStore.getState().join(opts);
      vi.clearAllMocks();

      useCallStore.setState({ isVideoOff: false });
      expect(sent().filter(([type]) => type === 'camera_on')).toHaveLength(0);
      expect(sent().filter(([type]) => type === 'camera_off')).toHaveLength(1);

      useCallStore.getState().reset();
    });

    it('появление участников переобъявляет камеру одним событием после дебаунса', async () => {
      vi.useFakeTimers();
      try {
        await useCallStore.getState().join(opts);
        vi.clearAllMocks();

        callbacks.onPeerJoined('u-2', 'snapshot');
        callbacks.onPeerJoined('u-3', 'snapshot');
        expect(sent().some(([type]) => type === 'camera_off')).toBe(false);

        vi.advanceTimersByTime(CAMERA_REANNOUNCE_DEBOUNCE_MS);
        expect(sent().filter(([type]) => type === 'camera_off')).toHaveLength(1);

        // Звонок закончился до срабатывания таймера — ничего не шлём.
        callbacks.onPeerJoined('u-4', 'live');
        useCallStore.getState().reset();
        vi.clearAllMocks();
        vi.advanceTimersByTime(CAMERA_REANNOUNCE_DEBOUNCE_MS);
        expect(sent().some(([type]) => type === 'camera_off' || type === 'camera_on')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('screen_share_stopped чистит шарера и отписывается от демонстрации', async () => {
      await useCallStore.getState().join(opts);
      callbacks.onPeerJoined('u-2', 'live');
      wsHandlers.get('screen_share_started')!({ user_id: 'u-2' });
      expect(useCallStore.getState().screenSharers.has('u-2')).toBe(true);

      wsHandlers.get('screen_share_stopped')!({ user_id: 'u-2' });

      expect(useCallStore.getState().screenSharers.has('u-2')).toBe(false);
      expect(groupCallService.unwatchShare).toHaveBeenCalledWith('u-2');

      useCallStore.getState().reset();
    });

    it('входящие WS-события вне звонка игнорируются', () => {
      useCallStore.getState().reset();
      wsHandlers.get('mic_muted')!({ user_id: 'u-2' });
      expect(useCallStore.getState().remoteMicMuted.size).toBe(0);
    });

    it('onScreenShareEnded снимает флаг шаринга и объявляет остановку', () => {
      useCallStore.setState({ isScreenSharing: true });

      callbacks.onScreenShareEnded?.();

      expect(useCallStore.getState().isScreenSharing).toBe(false);
      expect(sent().some(([type]) => type === 'screen_share_stopped')).toBe(true);
    });
  });
});
