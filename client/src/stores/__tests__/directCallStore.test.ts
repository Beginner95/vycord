import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Listener = (p: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
const sent: Array<[string, unknown]> = [];
vi.mock('@/services/websocket', () => ({
  wsService: {
    on: (type: string, l: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(l);
      return () => listeners.get(type)!.delete(l);
    },
    send: (type: string, p: unknown) => { sent.push([type, p]); },
  },
}));
const emit = (type: string, p: unknown) => listeners.get(type)?.forEach((l) => l(p));

vi.mock('@/services/audio', () => ({
  audioService: {
    startRingtone: vi.fn(), stopRingtone: vi.fn(), startRingback: vi.fn(), stopRingback: vi.fn(),
    playBusy: vi.fn(), playCallEnded: vi.fn(), playCallAccepted: vi.fn(),
  },
}));

let peerJoins = true;
const callStoreState = {
  callRoomId: null as string | null,
  callKind: null as 'channel' | 'direct' | null,
  lastExit: null as 'leave' | 'reset' | null,
  callPeer: null as { id: string; username: string } | null,
  participants: [] as Array<{ userId: string }>,
  join: vi.fn(async (o: { callId: string; peer?: { id: string; username: string } }) => {
    callStoreState.callRoomId = o.callId;
    callStoreState.callPeer = o.peer ?? null;
    callStoreState.callKind = 'direct';
    // По умолчанию собеседник уже в комнате (иначе взводится grace I-3).
    if (peerJoins && o.peer) callStoreState.participants = [{ userId: o.peer.id }];
    notify();
  }),
  leave: vi.fn(() => {
    callStoreState.callRoomId = null;
    callStoreState.callKind = null;
    callStoreState.lastExit = 'leave';
    notify();
  }),
};
const subs = new Set<(s: typeof callStoreState, p: typeof callStoreState) => void>();
let prevSnapshot = { ...callStoreState };
function notify() {
  const next = { ...callStoreState };
  subs.forEach((f) => f(next, prevSnapshot));
  prevSnapshot = next;
}
vi.mock('@/stores/callStore', () => ({
  useCallStore: Object.assign(() => callStoreState, {
    getState: () => callStoreState,
    subscribe: (f: (s: typeof callStoreState, p: typeof callStoreState) => void) => { subs.add(f); return () => subs.delete(f); },
  }),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'me', username: 'me' } }) },
}));

import { useDirectCallStore, initDirectCallBridge, resetDirectCall, DIRECT_CALL_ENDING_MS, PEER_LEFT_GRACE_MS } from '@/stores/directCallStore';
import { audioService } from '@/services/audio';

const me = { id: 'me', username: 'me' };
const bob = { id: 'bob', username: 'bob' };
let off: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  sent.length = 0;
  listeners.clear();
  subs.clear();
  Object.assign(callStoreState, { callRoomId: null, callKind: null, lastExit: null, callPeer: null, participants: [] });
  prevSnapshot = { ...callStoreState };
  useDirectCallStore.setState({ phase: { kind: 'idle' }, missed: [], viewOpen: false, lastError: null });
  peerJoins = true;
  off = initDirectCallBridge();
});
afterEach(() => { off(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('directCallStore', () => {
  it('исходящий: call → call_start, ringing → outgoing с callId и гудки', () => {
    useDirectCallStore.getState().call(bob);
    expect(sent).toContainEqual(['call_start', { receiver_id: 'bob' }]);
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'outgoing', callId: null, peer: bob });
    expect(useDirectCallStore.getState().viewOpen).toBe(true);

    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: me, receiver: bob });
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'outgoing', callId: 'c1', peer: bob });
    expect(audioService.startRingback).toHaveBeenCalled();
  });

  it('входящий: карточка; при текущем звонке wouldSwitch и тихий рингтон', () => {
    callStoreState.callRoomId = 'channel-x';
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'incoming', callId: 'c1', peer: bob, wouldSwitch: true });
    expect(audioService.startRingtone).toHaveBeenCalledWith({ quiet: true });
  });

  it('accept → call_accept; call_accepted → join direct → active', async () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    useDirectCallStore.getState().accept();
    expect(sent).toContainEqual(['call_accept', { call_id: 'c1' }]);

    emit('call_accepted', { call_id: 'c1' });
    await vi.runOnlyPendingTimersAsync();
    expect(callStoreState.join).toHaveBeenCalledWith(expect.objectContaining({ kind: 'direct', callId: 'c1', peer: bob }));
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'active', callId: 'c1', peer: bob });
  });

  it('reject → call_reject и idle', () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    useDirectCallStore.getState().reject();
    expect(sent).toContainEqual(['call_reject', { call_id: 'c1' }]);
    expect(useDirectCallStore.getState().phase.kind).toBe('idle');
    expect(audioService.stopRingtone).toHaveBeenCalled();
  });

  it('пропущенный: входящий + call_ended timeout → в missed, ending → idle', () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    emit('call_ended', { call_id: 'c1', reason: 'timeout' });
    expect(useDirectCallStore.getState().missed).toEqual([expect.objectContaining({ callId: 'c1', peer: bob })]);
    vi.advanceTimersByTime(DIRECT_CALL_ENDING_MS);
    expect(useDirectCallStore.getState().phase.kind).toBe('idle');
  });

  it('отказ у звонящего: call_ended rejected → ending rejected и playBusy', () => {
    useDirectCallStore.getState().call(bob);
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: me, receiver: bob });
    emit('call_ended', { call_id: 'c1', reason: 'rejected' });
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'ending', peer: bob, reason: 'rejected' });
    expect(audioService.playBusy).toHaveBeenCalled();
    expect(audioService.stopRingback).toHaveBeenCalled();
  });

  it('call_error при старте → idle и lastError', () => {
    useDirectCallStore.getState().call(bob);
    emit('call_error', { code: 'forbidden' });
    expect(useDirectCallStore.getState().phase.kind).toBe('idle');
    expect(useDirectCallStore.getState().lastError).toBe('forbidden');
  });

  it('call_ended в активном звонке → leave комнаты', async () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    useDirectCallStore.getState().accept();
    emit('call_accepted', { call_id: 'c1' });
    await vi.runOnlyPendingTimersAsync();
    sent.length = 0;
    emit('call_ended', { call_id: 'c1', reason: 'ended' });
    expect(callStoreState.leave).toHaveBeenCalled();
    expect(sent.find(([t]) => t === 'call_end')).toBeUndefined(); // сервер уже завершил — эхо не шлём
  });

  it('выход из комнаты кнопкой (leave) → call_end ended', async () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    useDirectCallStore.getState().accept();
    emit('call_accepted', { call_id: 'c1' });
    await vi.runOnlyPendingTimersAsync();
    sent.length = 0;
    callStoreState.leave();
    expect(sent).toContainEqual(['call_end', { call_id: 'c1', reason: 'ended' }]);
  });

  it('сброс комнаты (reset: обрыв) → call_end failed', async () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    useDirectCallStore.getState().accept();
    emit('call_accepted', { call_id: 'c1' });
    await vi.runOnlyPendingTimersAsync();
    sent.length = 0;
    Object.assign(callStoreState, { callRoomId: null, callKind: null, lastExit: 'reset' });
    notify();
    expect(sent).toContainEqual(['call_end', { call_id: 'c1', reason: 'failed' }]);
  });

  it('собеседник ушёл из SFU и не вернулся за 15 с → call_end failed', async () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    useDirectCallStore.getState().accept();
    emit('call_accepted', { call_id: 'c1' });
    await vi.runOnlyPendingTimersAsync();
    callStoreState.participants = [{ userId: 'bob' }];
    notify();
    sent.length = 0;
    callStoreState.participants = [];
    notify();
    vi.advanceTimersByTime(PEER_LEFT_GRACE_MS - 1);
    expect(sent.find(([t]) => t === 'call_end')).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(sent).toContainEqual(['call_end', { call_id: 'c1', reason: 'failed' }]);
  });

  it('call_state active после реконнекта WS → снова входит в комнату', async () => {
    emit('call_state', { call: { call_id: 'c1', status: 'active', caller: bob, receiver: me } });
    await vi.runOnlyPendingTimersAsync();
    expect(callStoreState.join).toHaveBeenCalledWith(expect.objectContaining({ callId: 'c1' }));
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'active', callId: 'c1', peer: bob });
  });

  it('hangup в активном звонке: call_end и выход из комнаты', async () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    useDirectCallStore.getState().accept();
    emit('call_accepted', { call_id: 'c1' });
    await vi.runOnlyPendingTimersAsync();
    sent.length = 0;
    useDirectCallStore.getState().hangup();
    expect(sent.filter(([t]) => t === 'call_end')).toEqual([['call_end', { call_id: 'c1' }]]); // ровно один, без эха
    expect(callStoreState.leave).toHaveBeenCalled();
    expect(useDirectCallStore.getState().phase.kind).toBe('ending');
  });

  it('call_state null сбрасывает зависшую фазу', () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    emit('call_state', { call: null });
    expect(useDirectCallStore.getState().phase.kind).toBe('idle');
  });
});

describe('directCallStore: переключение и гонки', () => {
  const carol = { id: 'carol', username: 'carol' };
  const enterActive = async (id: string, peer: typeof bob) => {
    emit('call_ringing', { call_id: id, status: 'ringing', caller: peer, receiver: me });
    useDirectCallStore.getState().accept();
    emit('call_accepted', { call_id: id });
    await vi.runOnlyPendingTimersAsync();
  };

  it('accept Y из активного X: join(Y) делает leave(X) — call_end не шлётся ни для Y, ни для X', async () => {
    await enterActive('x1', bob);
    expect(useDirectCallStore.getState().phase.kind).toBe('active');
    emit('call_ringing', { call_id: 'y1', status: 'ringing', caller: carol, receiver: me });
    expect(useDirectCallStore.getState().phase).toMatchObject({ kind: 'incoming', callId: 'y1', wouldSwitch: true });
    useDirectCallStore.getState().accept();
    sent.length = 0;
    // Реальный join: сначала leave() старой комнаты (промежуточное idle + lastExit leave).
    callStoreState.join.mockImplementationOnce(async (o: { callId: string; peer?: { id: string; username: string } }) => {
      callStoreState.leave();
      callStoreState.callPeer = o.peer ?? null;
      callStoreState.lastExit = null;
      callStoreState.callRoomId = o.callId;
      callStoreState.callKind = 'direct';
      callStoreState.participants = [{ userId: 'carol' }];
      notify();
    });
    emit('call_accepted', { call_id: 'y1' });
    await vi.runOnlyPendingTimersAsync();
    expect(sent).not.toContainEqual(['call_end', { call_id: 'y1', reason: 'ended' }]);
    expect(sent.filter(([t, p]) => t === 'call_end' && (p as { call_id: string }).call_id === 'y1')).toEqual([]);
    // X сервер завершает сам при accept Y — клиентский call_end дал бы invalid_state.
    expect(sent.find(([t]) => t === 'call_end')).toBeUndefined();
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'active', callId: 'y1', peer: carol });
  });

  it('hangup во время connecting: join закончился позже — выходим из комнаты', async () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    useDirectCallStore.getState().accept();
    let resolveJoin!: () => void;
    callStoreState.join.mockImplementationOnce((o: { callId: string }) => new Promise<void>((r) => {
      resolveJoin = () => { callStoreState.callRoomId = o.callId; callStoreState.callKind = 'direct'; notify(); r(); };
    }));
    emit('call_accepted', { call_id: 'c1' });
    useDirectCallStore.getState().hangup();
    sent.length = 0;
    resolveJoin();
    await vi.advanceTimersByTimeAsync(0);
    expect(callStoreState.leave).toHaveBeenCalled();
    expect(sent.find(([t]) => t === 'call_end')).toBeUndefined();
    expect(useDirectCallStore.getState().phase.kind).toBe('ending');
  });

  it('ошибка join → call_end failed (один раз)', async () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    useDirectCallStore.getState().accept();
    callStoreState.join.mockRejectedValueOnce(new Error('boom'));
    emit('call_accepted', { call_id: 'c1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.filter(([t]) => t === 'call_end')).toEqual([['call_end', { call_id: 'c1', reason: 'failed' }]]);
    expect(useDirectCallStore.getState().phase).toMatchObject({ kind: 'ending', reason: 'failed' });
  });

  it('переключение X→Y сбрасывает таймер ухода собеседника X', async () => {
    await enterActive('x1', bob);
    callStoreState.participants = [{ userId: 'bob' }];
    notify();
    callStoreState.participants = [];
    notify();
    emit('call_ringing', { call_id: 'y1', status: 'ringing', caller: carol, receiver: me });
    useDirectCallStore.getState().accept();
    emit('call_accepted', { call_id: 'y1' });
    await vi.runOnlyPendingTimersAsync();
    sent.length = 0;
    vi.advanceTimersByTime(PEER_LEFT_GRACE_MS);
    expect(sent.find(([t]) => t === 'call_end')).toBeUndefined();
  });

  const ringY = () => emit('call_ringing', { call_id: 'y1', status: 'ringing', caller: carol, receiver: me });

  it('reject Y поверх активного X → возвращается active X; потом call_ended X выходит из комнаты', async () => {
    await enterActive('x1', bob);
    ringY();
    useDirectCallStore.getState().reject();
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'active', callId: 'x1', peer: bob });
    sent.length = 0;
    emit('call_ended', { call_id: 'x1', reason: 'ended' });
    expect(callStoreState.leave).toHaveBeenCalled();
    expect(sent.find(([t]) => t === 'call_end')).toBeUndefined();
    expect(useDirectCallStore.getState().phase.kind).toBe('ending');
  });

  it('Y пропущен (timeout) поверх X → active X и запись в missed', async () => {
    await enterActive('x1', bob);
    ringY();
    emit('call_ended', { call_id: 'y1', reason: 'timeout' });
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'active', callId: 'x1', peer: bob });
    expect(useDirectCallStore.getState().missed).toEqual([expect.objectContaining({ callId: 'y1' })]);
  });

  it('собеседник X бросил трубку, пока звонит Y → выходим из комнаты X молча, wouldSwitch=false', async () => {
    await enterActive('x1', bob);
    ringY();
    sent.length = 0;
    emit('call_ended', { call_id: 'x1', reason: 'ended' });
    expect(callStoreState.leave).toHaveBeenCalled();
    expect(sent.find(([t]) => t === 'call_end')).toBeUndefined();
    expect(audioService.playCallEnded).not.toHaveBeenCalled();
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'incoming', callId: 'y1', peer: carol, wouldSwitch: false });
  });

  it('звоним Z из активного X, call_ended X при outgoing → выходим из комнаты, фаза outgoing цела', async () => {
    await enterActive('x1', bob);
    useDirectCallStore.getState().call(carol);
    emit('call_ringing', { call_id: 'z1', status: 'ringing', caller: me, receiver: carol });
    sent.length = 0;
    emit('call_ended', { call_id: 'x1', reason: 'ended' });
    expect(callStoreState.leave).toHaveBeenCalled();
    expect(sent.find(([t]) => t === 'call_end')).toBeUndefined();
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'outgoing', callId: 'z1', peer: carol });
  });

  it('call_error про чужой call_id игнорируется (нет тоста)', async () => {
    await enterActive('x1', bob);
    ringY();
    emit('call_error', { code: 'invalid_state', call_id: 'x1' });
    expect(useDirectCallStore.getState().lastError).toBeNull();
    expect(useDirectCallStore.getState().phase.kind).toBe('incoming');
  });

  it('call_state null в активном звонке: без эха call_end и без звука конца', async () => {
    await enterActive('x1', bob);
    sent.length = 0;
    emit('call_state', { call: null });
    expect(callStoreState.leave).toHaveBeenCalled();
    expect(sent.find(([t]) => t === 'call_end')).toBeUndefined();
    expect(audioService.playCallEnded).not.toHaveBeenCalled();
    expect(useDirectCallStore.getState().phase.kind).toBe('idle');
  });

  it('call_state active во время connecting того же звонка не вызывает повторный join и не выходит из комнаты', async () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    useDirectCallStore.getState().accept();
    emit('call_accepted', { call_id: 'c1' });
    emit('call_state', { call: { call_id: 'c1', status: 'active', caller: bob, receiver: me } });
    await vi.advanceTimersByTimeAsync(0);
    expect(callStoreState.join).toHaveBeenCalledTimes(1);
    expect(callStoreState.leave).not.toHaveBeenCalled();
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'active', callId: 'c1', peer: bob });
  });

  it('call() из incoming гасит рингтон', () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    useDirectCallStore.getState().call(carol);
    expect(audioService.stopRingtone).toHaveBeenCalled();
  });

  it('повторный call_accepted при join в полёте и после active не даёт второго join', async () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    useDirectCallStore.getState().accept();
    emit('call_accepted', { call_id: 'c1' });
    emit('call_accepted', { call_id: 'c1' });
    await vi.advanceTimersByTimeAsync(0);
    emit('call_accepted', { call_id: 'c1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(callStoreState.join).toHaveBeenCalledTimes(1);
    expect(callStoreState.leave).not.toHaveBeenCalled();
  });
});

describe('directCallStore: финальная волна исправлений', () => {
  const carol = { id: 'carol', username: 'carol' };
  const enterActive = async (id: string, peer: typeof bob, present = true) => {
    emit('call_ringing', { call_id: id, status: 'ringing', caller: peer, receiver: me });
    useDirectCallStore.getState().accept();
    peerJoins = present;
    emit('call_accepted', { call_id: id });
    await vi.advanceTimersByTimeAsync(0);
  };
  const callEnds = () => sent.filter(([t]) => t === 'call_end');

  // I-1
  it('I-1a: «Позвонить» тому, кто сейчас звонит мне → принимаем входящий', () => {
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: bob, receiver: me });
    sent.length = 0;
    useDirectCallStore.getState().call(bob);
    expect(sent).toEqual([['call_accept', { call_id: 'c1' }]]);
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'connecting', callId: 'c1', peer: bob });
  });

  it('I-1b: «Позвонить» собеседнику текущего звонка → просто открывает экран', async () => {
    await enterActive('x1', bob);
    useDirectCallStore.getState().closeView();
    sent.length = 0;
    useDirectCallStore.getState().call(bob);
    expect(sent).toEqual([]);
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'active', callId: 'x1', peer: bob });
    expect(useDirectCallStore.getState().viewOpen).toBe(true);
  });

  it('I-1c: outgoing(null) + call_accepted неизвестного звонка (встречный/повтор) → входим в комнату', async () => {
    useDirectCallStore.getState().call(bob);
    emit('call_accepted', { call_id: 'c9' });
    await vi.advanceTimersByTimeAsync(0);
    expect(callStoreState.join).toHaveBeenCalledWith(expect.objectContaining({ callId: 'c9', peer: bob }));
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'active', callId: 'c9', peer: bob });
  });

  // I-2
  it('I-2a: call_error при звонке из активного X → возвращаемся к X, hangup завершает X', async () => {
    await enterActive('x1', bob);
    useDirectCallStore.getState().call(carol);
    emit('call_error', { code: 'busy' });
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'active', callId: 'x1', peer: bob });
    expect(useDirectCallStore.getState().viewOpen).toBe(true);
    expect(useDirectCallStore.getState().lastError).toBe('busy');
    sent.length = 0;
    useDirectCallStore.getState().hangup();
    expect(callEnds()).toEqual([['call_end', { call_id: 'x1' }]]);
    expect(callStoreState.leave).toHaveBeenCalled();
  });

  it('I-2b: hangup, пока поверх X звонит Y → завершает X (без эха), Y звонит дальше', async () => {
    await enterActive('x1', bob);
    emit('call_ringing', { call_id: 'y1', status: 'ringing', caller: carol, receiver: me });
    sent.length = 0;
    useDirectCallStore.getState().hangup();
    expect(callEnds()).toEqual([['call_end', { call_id: 'x1' }]]);
    expect(callStoreState.leave).toHaveBeenCalled();
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'incoming', callId: 'y1', peer: carol, wouldSwitch: false });
  });

  it('I-2c: фаза idle, а комната 1:1 открыта → hangup всё равно завершает звонок комнаты', () => {
    Object.assign(callStoreState, { callRoomId: 'x1', callKind: 'direct', callPeer: bob });
    notify();
    useDirectCallStore.getState().hangup();
    expect(callEnds()).toEqual([['call_end', { call_id: 'x1' }]]);
    expect(callStoreState.leave).toHaveBeenCalled();
  });

  // I-3
  it('I-3a: собеседник так и не вошёл в комнату → через grace call_end failed', async () => {
    await enterActive('c1', bob, false);
    expect(useDirectCallStore.getState().phase.kind).toBe('active');
    vi.advanceTimersByTime(PEER_LEFT_GRACE_MS - 1);
    expect(callEnds()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(callEnds()).toEqual([['call_end', { call_id: 'c1', reason: 'failed' }]]);
    expect(useDirectCallStore.getState().phase).toMatchObject({ kind: 'ending', reason: 'failed' });
  });

  it('I-3b: собеседник вошёл в пределах grace → таймер снят', async () => {
    await enterActive('c1', bob, false);
    vi.advanceTimersByTime(PEER_LEFT_GRACE_MS - 1000);
    callStoreState.participants = [{ userId: 'bob' }];
    notify();
    vi.advanceTimersByTime(PEER_LEFT_GRACE_MS);
    expect(callEnds()).toEqual([]);
  });

  it('I-3c: возврат к X после отклонения Y, собеседника X нет → таймер взводится', async () => {
    await enterActive('x1', bob);
    emit('call_ringing', { call_id: 'y1', status: 'ringing', caller: carol, receiver: me });
    callStoreState.participants = [];
    notify(); // в фазе incoming подписка таймер не взводит
    useDirectCallStore.getState().reject();
    sent.length = 0;
    vi.advanceTimersByTime(PEER_LEFT_GRACE_MS);
    expect(callEnds()).toEqual([['call_end', { call_id: 'x1', reason: 'failed' }]]);
  });

  // I-5
  it('I-5: call_error rate_limited при старте → idle и lastError', () => {
    useDirectCallStore.getState().call(bob);
    emit('call_error', { code: 'rate_limited' });
    expect(useDirectCallStore.getState().phase.kind).toBe('idle');
    expect(useDirectCallStore.getState().lastError).toBe('rate_limited');
  });

  // M-1
  it('M-1: отмена до call_ringing → пришедший call_ringing гасится call_end, фаза idle', () => {
    useDirectCallStore.getState().call(bob);
    useDirectCallStore.getState().hangup();
    sent.length = 0;
    emit('call_ringing', { call_id: 'c1', status: 'ringing', caller: me, receiver: bob });
    expect(callEnds()).toEqual([['call_end', { call_id: 'c1' }]]);
    expect(useDirectCallStore.getState().phase.kind).toBe('idle');
    expect(useDirectCallStore.getState().viewOpen).toBe(false);
    expect(audioService.startRingback).not.toHaveBeenCalled();
    // Следующий звонок тому же — обычный.
    useDirectCallStore.getState().call(bob);
    emit('call_ringing', { call_id: 'c2', status: 'ringing', caller: me, receiver: bob });
    expect(useDirectCallStore.getState().phase).toEqual({ kind: 'outgoing', callId: 'c2', peer: bob });
  });

  // M-3
  it('M-3: resetDirectCall сбрасывает стор, таймеры и звуки', async () => {
    await enterActive('c1', bob, false);
    useDirectCallStore.setState({ missed: [{ callId: 'm', peer: bob, at: 1 }], lastError: 'busy' });
    sent.length = 0;
    resetDirectCall();
    expect(useDirectCallStore.getState()).toMatchObject({ phase: { kind: 'idle' }, missed: [], lastError: null, viewOpen: false });
    expect(audioService.stopRingtone).toHaveBeenCalled();
    vi.advanceTimersByTime(PEER_LEFT_GRACE_MS);
    expect(callEnds()).toEqual([]);
  });
});
