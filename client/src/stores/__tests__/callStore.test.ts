import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

vi.mock('@/services/groupCall', () => ({
  groupCallService: {
    isInGroupCallState: false,
    currentRoomIdState: '',
    isMicrophoneAvailable: true,
    isScreenSharing: false,
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

import { useCallStore, initCallBridge } from '@/stores/callStore';
import { groupCallService } from '@/services/groupCall';
import type { GroupCallCallbacks } from '@/services/groupCall';
import { wsService } from '@/services/websocket';
import { audioService } from '@/services/audio';

const gc = groupCallService as unknown as {
  isInGroupCallState: boolean;
  currentRoomIdState: string;
  isMicrophoneAvailable: boolean;
  isScreenSharing: boolean;
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
        'connection_quality',
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
