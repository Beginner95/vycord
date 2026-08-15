import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/services/groupCall', () => ({
  groupCallService: {
    isInGroupCallState: false,
    currentRoomIdState: '',
    isMicrophoneAvailable: true,
    isScreenSharing: false,
    joinGroupCall: vi.fn(),
    leaveGroupCall: vi.fn(),
    toggleMuteAudio: vi.fn(() => true),
    toggleMuteVideo: vi.fn(() => true),
  },
}));
vi.mock('@/services/websocket', () => ({ wsService: { send: vi.fn() } }));
vi.mock('@/services/audio', () => ({
  audioService: { playUserJoined: vi.fn(), playUserLeft: vi.fn() },
}));

import { useCallStore } from '@/stores/callStore';
import { groupCallService } from '@/services/groupCall';
import { wsService } from '@/services/websocket';
import { audioService } from '@/services/audio';

const gc = groupCallService as unknown as {
  isInGroupCallState: boolean;
  currentRoomIdState: string;
  isMicrophoneAvailable: boolean;
  isScreenSharing: boolean;
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
});
