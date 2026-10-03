import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock поднимается выше объявлений: всё, что фабрика читает при
// вычислении, создаётся в vi.hoisted, иначе ReferenceError (TDZ).
const { sent, gc, marked } = vi.hoisted(() => {
  const gc = {
    isInGroupCallState: false,
    currentRoomIdState: null as string | null,
    isMicrophoneAvailable: true,
    lastMediaWarningState: null,
    isScreenSharing: false,
    localStreamState: null,
    joinGroupCall: vi.fn(async (roomId: string) => { gc.currentRoomIdState = roomId; gc.isInGroupCallState = true; return true; }),
    leaveGroupCall: vi.fn(() => { gc.currentRoomIdState = null; gc.isInGroupCallState = false; }),
  };
  return { sent: [] as Array<[string, Record<string, unknown>]>, gc, marked: [] as Array<string | null> };
});
vi.mock('@/services/callBus', () => ({
  callBus: { send: vi.fn((t: string, p: Record<string, unknown>) => { sent.push([t, p]); }), on: vi.fn(() => () => {}) },
}));
vi.mock('@/services/groupCall', () => ({ groupCallService: gc }));
vi.mock('@/services/audio', () => ({ audioService: { playUserJoined: vi.fn(), playUserLeft: vi.fn() } }));
vi.mock('@/services/callCredentials', () => ({ markDirectCallRoom: (id: string | null) => marked.push(id) }));

import { useCallStore } from '@/stores/callStore';

const peer = { id: 'u-b', username: 'bob' };

describe('callStore: звонок 1:1', () => {
  beforeEach(() => {
    sent.length = 0;
    marked.length = 0;
    gc.currentRoomIdState = null;
    gc.isInGroupCallState = false;
    useCallStore.getState().reset();
  });

  it('join direct: комната = callId, без voice_* событий, канал = null', async () => {
    await useCallStore.getState().join({ kind: 'direct', callId: 'call-1', peer, userId: 'u-a', userName: 'alice' });
    const s = useCallStore.getState();
    expect(gc.joinGroupCall).toHaveBeenCalledWith('call-1', 'u-a');
    expect(s.callKind).toBe('direct');
    expect(s.callRoomId).toBe('call-1');
    expect(s.callChannelId).toBeNull();
    expect(s.callPeer).toEqual(peer);
    expect(s.status).toBe('connected');
    expect(marked).toContain('call-1');
    const types = sent.map(([t]) => t);
    expect(types).not.toContain('voice_joined');
    expect(types).not.toContain('voice_call_ring');
    expect(types).toContain('mic_unmuted');
  });

  it('leave direct: без voice_left/voice_call_cancel, lastExit = leave', async () => {
    await useCallStore.getState().join({ kind: 'direct', callId: 'call-1', peer, userId: 'u-a', userName: 'alice' });
    sent.length = 0;
    useCallStore.getState().leave();
    const types = sent.map(([t]) => t);
    expect(types).not.toContain('voice_left');
    expect(types).not.toContain('voice_call_cancel');
    expect(useCallStore.getState().callRoomId).toBeNull();
    expect(useCallStore.getState().lastExit).toBe('leave');
    expect(marked[marked.length - 1]).toBeNull();
  });

  it('join в другую комнату, будучи в звонке, сначала выходит из текущего', async () => {
    await useCallStore.getState().join({
      channelId: 'ch-1', channelName: 'general', serverId: 's', serverName: 'S', userId: 'u-a', userName: 'alice',
    });
    sent.length = 0;
    await useCallStore.getState().join({ kind: 'direct', callId: 'call-1', peer, userId: 'u-a', userName: 'alice' });
    expect(gc.leaveGroupCall).toHaveBeenCalled();
    expect(sent.map(([t]) => t)).toContain('voice_left');
    expect(useCallStore.getState().callRoomId).toBe('call-1');
  });

  it('reset помечает lastExit = reset', async () => {
    await useCallStore.getState().join({ kind: 'direct', callId: 'call-1', peer, userId: 'u-a', userName: 'alice' });
    useCallStore.getState().reset();
    expect(useCallStore.getState().lastExit).toBe('reset');
  });
});
