import { create } from 'zustand';
import { wsService } from '@/services/websocket';
import { audioService } from '@/services/audio';
import { useCallStore } from '@/stores/callStore';
import { useAuthStore } from '@/stores/authStore';
import { logger } from '@/utils/logger';
import type { CallEndReason, CallErrorCode, CallPeer, CallSnapshot } from '@/types/directCall';

/**
 * Клиентская сторона протокола звонков 1:1 (VYC-103). Жизненным циклом владеет
 * сервер; стор лишь отражает его события и переводит их в вход/выход из
 * комнаты SFU через callStore. Спека: docs/superpowers/specs/2026-10-03-direct-calls-design.md.
 */

export type DirectCallPhase =
  | { kind: 'idle' }
  | { kind: 'outgoing'; callId: string | null; peer: CallPeer }
  | { kind: 'incoming'; callId: string; peer: CallPeer; wouldSwitch: boolean }
  | { kind: 'connecting'; callId: string; peer: CallPeer }
  | { kind: 'active'; callId: string; peer: CallPeer }
  | { kind: 'ending'; peer: CallPeer; reason: CallEndReason };

export interface MissedCall {
  callId: string;
  peer: CallPeer;
  at: number;
}

/** Сколько висит исход звонка («Отклонён», «Не отвечает») перед закрытием. */
export const DIRECT_CALL_ENDING_MS = 2500;
/** Grace ухода собеседника из комнаты SFU — совпадает с grace самого SFU. */
export const PEER_LEFT_GRACE_MS = 15_000;

interface DirectCallState {
  phase: DirectCallPhase;
  missed: MissedCall[];
  /** Открыт ли экран звонка в основной колонке (десктоп) / экран звонка (мобильный). */
  viewOpen: boolean;
  lastError: CallErrorCode | null;
  call: (peer: CallPeer) => void;
  accept: () => void;
  reject: () => void;
  hangup: () => void;
  dismissMissed: (callId: string) => void;
  openView: () => void;
  closeView: () => void;
  clearError: () => void;
}

const callIdOf = (p: DirectCallPhase): string | null =>
  p.kind === 'idle' || p.kind === 'ending' ? null : p.callId;

const peerOf = (p: DirectCallPhase): CallPeer | null => (p.kind === 'idle' ? null : p.peer);

let endingTimer: ReturnType<typeof setTimeout> | null = null;
let peerLeftTimer: ReturnType<typeof setTimeout> | null = null;
/** Звонок, для которого взведён peerLeftTimer. */
let peerLeftCallId: string | null = null;
/**
 * Собеседник, исходящий к которому отменён до call_ringing (callId ещё null).
 * Сервер звонок уже создаёт — его call_ringing гасим call_end, а не открываем экран.
 */
let cancelledPeerId: string | null = null;

function stopSounds(): void {
  audioService.stopRingtone();
  audioService.stopRingback();
}

function clearPeerLeft(): void {
  if (peerLeftTimer !== null) clearTimeout(peerLeftTimer);
  peerLeftTimer = null;
  peerLeftCallId = null;
}

/**
 * Взводит grace ухода собеседника для активного callId. Уже идущий таймер того
 * же звонка не перезапускается (окно не продлевается каждым обновлением комнаты).
 */
function armPeerLeft(callId: string): void {
  if (peerLeftTimer !== null && peerLeftCallId === callId) return;
  clearPeerLeft();
  peerLeftCallId = callId;
  peerLeftTimer = setTimeout(() => {
    peerLeftTimer = null;
    peerLeftCallId = null;
    const cur = useDirectCallStore.getState().phase;
    if (cur.kind === 'active' && cur.callId === callId) {
      wsService.send('call_end', { call_id: callId, reason: 'failed' });
      finish(cur.peer, 'failed');
      if (useCallStore.getState().callRoomId === callId) useCallStore.getState().leave();
    }
  }, PEER_LEFT_GRACE_MS);
}

/**
 * Вход в active: если собеседника в комнате нет, сразу взводим тот же grace —
 * иначе звонок, в комнату которого собеседник так и не вошёл, висел бы вечно
 * (подписка ниже реагирует только на переход «был → пропал»).
 */
function watchPeer(callId: string, peer: CallPeer): void {
  if (useCallStore.getState().participants.some((x) => x.userId === peer.id)) return;
  armPeerLeft(callId);
}

export const useDirectCallStore = create<DirectCallState>((set, get) => ({
  phase: { kind: 'idle' },
  missed: [],
  viewOpen: false,
  lastError: null,

  call: (peer) => {
    const p = get().phase;
    // «Позвонить» тому, кто сейчас звонит мне, — это ответ (сервер сделал бы
    // то же встречным вызовом, но фаза осталась бы outgoing без callId).
    if (p.kind === 'incoming' && p.peer.id === peer.id) {
      get().accept();
      return;
    }
    // Уже в звонке с ним — просто показываем экран, повторный call_start не нужен.
    const cs = useCallStore.getState();
    const inRoomWith = cs.callKind === 'direct' && cs.callRoomId !== null && cs.callPeer?.id === peer.id;
    if (((p.kind === 'active' || p.kind === 'connecting') && p.peer.id === peer.id) || inRoomWith) {
      set({ viewOpen: true });
      return;
    }
    if (p.kind === 'outgoing' || p.kind === 'connecting') return;
    if (p.kind === 'incoming') stopSounds();
    cancelledPeerId = null;
    wsService.send('call_start', { receiver_id: peer.id });
    set({ phase: { kind: 'outgoing', callId: null, peer }, viewOpen: true, lastError: null });
  },

  accept: () => {
    const p = get().phase;
    if (p.kind !== 'incoming') return;
    stopSounds();
    wsService.send('call_accept', { call_id: p.callId });
    set({ phase: { kind: 'connecting', callId: p.callId, peer: p.peer }, viewOpen: true });
  },

  reject: () => {
    const p = get().phase;
    if (p.kind !== 'incoming') return;
    stopSounds();
    wsService.send('call_reject', { call_id: p.callId });
    restoreOrIdle();
  },

  hangup: () => {
    const p = get().phase;
    if (p.kind === 'outgoing' && p.callId === null) {
      // call_id ещё не пришёл: запоминаем отмену, call_ringing этого звонка погасим.
      stopSounds();
      cancelledPeerId = p.peer.id;
      restoreOrIdle();
      if (get().phase.kind === 'idle') set({ viewOpen: false });
      return;
    }
    if (p.kind === 'outgoing' || p.kind === 'connecting' || p.kind === 'active') {
      wsService.send('call_end', { call_id: p.callId });
      // Сначала ending: ответный call_ended для фазы ending игнорируется, а
      // подписка на callStore не шлёт эхо call_end. Поэтому из комнаты выходим сами.
      finish(p.peer, 'ended', false);
      if (useCallStore.getState().callRoomId === p.callId) useCallStore.getState().leave();
      return;
    }
    // Фаза не про комнату (поверх X звонит Y, idle после сбоя): «Завершить»
    // относится к комнате 1:1, в которой мы сидим. Эха нет: подписка шлёт
    // call_end только для комнаты текущей фазы.
    const cs = useCallStore.getState();
    if (cs.callKind !== 'direct' || cs.callRoomId === null) return;
    wsService.send('call_end', { call_id: cs.callRoomId });
    clearPeerLeft();
    if (p.kind === 'incoming' && p.wouldSwitch) set({ phase: { ...p, wouldSwitch: false } });
    else if (p.kind === 'idle') set({ viewOpen: false });
    cs.leave();
  },

  dismissMissed: (callId) => set((s) => ({ missed: s.missed.filter((m) => m.callId !== callId) })),
  openView: () => set({ viewOpen: true }),
  closeView: () => set({ viewOpen: false }),
  clearError: () => set({ lastError: null }),
}));

/**
 * Входящий Y закончился без принятия, а клиент всё ещё в комнате 1:1 X
 * (Y звонил поверх X): возвращаем фазу active X. Иначе — idle. viewOpen не трогаем.
 */
function restoreOrIdle(): void {
  const cs = useCallStore.getState();
  if (cs.callKind === 'direct' && cs.callRoomId !== null && cs.callPeer) {
    useDirectCallStore.setState({ phase: { kind: 'active', callId: cs.callRoomId, peer: cs.callPeer } });
    watchPeer(cs.callRoomId, cs.callPeer);
  } else {
    useDirectCallStore.setState({ phase: { kind: 'idle' } });
  }
}

/** Переход в ending с исходом и звуком, затем в idle. */
function finish(peer: CallPeer, reason: CallEndReason, withSound = true): void {
  stopSounds();
  clearPeerLeft();
  if (withSound) {
    if (reason === 'rejected') audioService.playBusy();
    else audioService.playCallEnded();
  }
  useDirectCallStore.setState({ phase: { kind: 'ending', peer, reason } });
  if (endingTimer !== null) clearTimeout(endingTimer);
  endingTimer = setTimeout(() => {
    endingTimer = null;
    if (useDirectCallStore.getState().phase.kind === 'ending') {
      useDirectCallStore.setState({ phase: { kind: 'idle' }, viewOpen: false });
    }
  }, DIRECT_CALL_ENDING_MS);
}

const me = (): string | undefined => useAuthStore.getState().user?.id;

function onRinging(snap: CallSnapshot): void {
  const self = me();
  if (snap.caller.id === self) {
    if (cancelledPeerId === snap.receiver.id) {
      // Исходящий отменили до call_ringing — сервер его всё равно создал.
      cancelledPeerId = null;
      wsService.send('call_end', { call_id: snap.call_id });
      return;
    }
    useDirectCallStore.setState({ phase: { kind: 'outgoing', callId: snap.call_id, peer: snap.receiver }, viewOpen: true });
    audioService.startRingback();
    return;
  }
  const wouldSwitch = useCallStore.getState().callRoomId !== null;
  useDirectCallStore.setState({ phase: { kind: 'incoming', callId: snap.call_id, peer: snap.caller, wouldSwitch } });
  audioService.startRingtone({ quiet: wouldSwitch });
}

/** Звонок, для которого join в комнату сейчас в полёте (accept() ставит connecting раньше). */
let enteringCallId: string | null = null;

async function enterRoom(callId: string, peer: CallPeer): Promise<void> {
  enteringCallId = callId;
  try {
    await enterRoomInner(callId, peer);
  } finally {
    if (enteringCallId === callId) enteringCallId = null;
  }
}

async function enterRoomInner(callId: string, peer: CallPeer): Promise<void> {
  stopSounds();
  useDirectCallStore.setState({ phase: { kind: 'connecting', callId, peer }, viewOpen: true });
  clearPeerLeft();
  const user = useAuthStore.getState().user;
  if (!user) return;
  try {
    await useCallStore.getState().join({ kind: 'direct', callId, peer, userId: user.id, userName: user.username });
  } catch (err) {
    logger.error('[DirectCall] join failed', err, { module: 'directCall' });
    const cur = useDirectCallStore.getState().phase;
    // Звонок мог завершиться, пока шёл join, — тогда второй call_end не нужен.
    if (cur.kind === 'connecting' && cur.callId === callId) {
      wsService.send('call_end', { call_id: callId, reason: 'failed' });
      finish(peer, 'failed');
    }
    return;
  }
  const p = useDirectCallStore.getState().phase;
  if ((p.kind !== 'connecting' && p.kind !== 'active') || p.callId !== callId) {
    // Звонок завершили (hangup / call_ended), пока join был в полёте: комната
    // только что поднялась, а фаза уже не наша — выходим, чтобы не висеть в ней.
    // Эхо call_end подписка не шлёт: фаза не active|connecting этого звонка.
    if (useCallStore.getState().callRoomId === callId) useCallStore.getState().leave();
    return;
  }
  if (p.kind === 'connecting') {
    audioService.playCallAccepted();
    useDirectCallStore.setState({ phase: { kind: 'active', callId, peer } });
  }
  watchPeer(callId, p.peer);
}

/** Звонок уже в комнате (active) или join в полёте — повторный вход не нужен. */
const isEntered = (p: DirectCallPhase, callId: string): boolean =>
  (p.kind === 'active' && p.callId === callId) || enteringCallId === callId;

function onAccepted(callId: string): void {
  const p = useDirectCallStore.getState().phase;
  if (p.kind === 'outgoing' && p.callId === null) {
    // Ответ на наш call_start без call_ringing: встречный вызов того же
    // собеседника или повтор «Позвонить» в уже живой звонок с ним (сервер
    // переотправляет call_accepted) — оба про звонок с p.peer.
    const cs = useCallStore.getState();
    if (cs.callKind === 'direct' && cs.callRoomId === callId) {
      stopSounds();
      restoreOrIdle();
      useDirectCallStore.setState({ viewOpen: true });
      return;
    }
    if (enteringCallId !== callId) void enterRoom(callId, p.peer);
    return;
  }
  if (callIdOf(p) !== callId || isEntered(p, callId)) return;
  const peer = peerOf(p);
  if (peer) void enterRoom(callId, peer);
}

function onEnded(callId: string, reason: CallEndReason): void {
  const p = useDirectCallStore.getState().phase;
  const cs = useCallStore.getState();
  const inRoom = cs.callKind === 'direct' && cs.callRoomId === callId;
  if (callIdOf(p) !== callId) {
    // Звонок не текущая фаза (X закончился, пока звонит Y / исходящий Z), но мы
    // всё ещё в его комнате — выходим молча: без звука и без смены фазы. Эхо
    // call_end не уходит: фаза принадлежит другому звонку (или не active).
    if (inRoom) {
      clearPeerLeft();
      if (p.kind === 'incoming' && p.wouldSwitch) {
        useDirectCallStore.setState({ phase: { ...p, wouldSwitch: false } });
      }
      cs.leave();
    }
    return;
  }
  const peer = peerOf(p)!;
  if (p.kind === 'incoming' && cs.callKind === 'direct' && cs.callRoomId !== null) {
    // Y звонил поверх активного X и не был принят — возвращаемся к X.
    if (reason === 'missed' || reason === 'timeout') {
      useDirectCallStore.setState((st) => ({ missed: [...st.missed, { callId, peer, at: Date.now() }] }));
    }
    stopSounds();
    restoreOrIdle();
    return;
  }
  if (p.kind === 'incoming' && (reason === 'missed' || reason === 'timeout')) {
    useDirectCallStore.setState((s) => ({ missed: [...s.missed, { callId, peer, at: Date.now() }] }));
  }
  // Фаза уходит в ending ДО leave(): подписка ниже видит не-active фазу и
  // не шлёт эхо call_end на уже завершённый сервером звонок.
  finish(peer, reason);
  if (useCallStore.getState().callRoomId === callId) useCallStore.getState().leave();
  if (p.kind === 'incoming') useDirectCallStore.setState({ phase: { kind: 'idle' } });
}

function onError(code: CallErrorCode, callId?: string): void {
  const p = useDirectCallStore.getState().phase;
  // Ошибка про другой звонок (например, X, закрытый сервером при переключении) — не наша.
  if (callId !== undefined && callId !== callIdOf(p)) return;
  if (callId === undefined && p.kind !== 'outgoing' && cancelledPeerId !== null) {
    // Отказ на уже отменённый пользователем call_start — показывать нечего.
    cancelledPeerId = null;
    return;
  }
  useDirectCallStore.setState({ lastError: code });
  if (p.kind === 'outgoing' && p.callId === null) {
    // Сервер отказал до завершения текущих звонков (forbidden/offline/busy/
    // rate_limited проверяются раньше) — звонок X, из которого звонили, жив.
    stopSounds();
    restoreOrIdle();
    if (useDirectCallStore.getState().phase.kind === 'idle') useDirectCallStore.setState({ viewOpen: false });
  } else if (p.kind === 'incoming' && callId === p.callId && code === 'invalid_state') {
    stopSounds();
    restoreOrIdle();
  }
}

function onState(call: CallSnapshot | null): void {
  const p = useDirectCallStore.getState().phase;
  if (call === null) {
    if (p.kind !== 'idle' && p.kind !== 'ending') {
      stopSounds();
      clearPeerLeft();
      // Фаза в idle ДО leave(): иначе подписка на комнату шлёт эхо call_end.
      useDirectCallStore.setState({ phase: { kind: 'idle' }, viewOpen: false });
      if (useCallStore.getState().callKind === 'direct') useCallStore.getState().leave();
    }
    return;
  }
  if (call.status === 'ringing') {
    if (callIdOf(p) !== call.call_id) onRinging(call);
    return;
  }
  const peer = call.caller.id === me() ? call.receiver : call.caller;
  if (isEntered(p, call.call_id)) return;
  void enterRoom(call.call_id, peer);
}

/** Подписки на WS и на callStore. Вызывается один раз на сессию (useAppController). */
export function initDirectCallBridge(): () => void {
  const offs = [
    wsService.on('call_ringing', (pl) => onRinging(pl as CallSnapshot)),
    wsService.on('call_accepted', (pl) => onAccepted((pl as { call_id: string }).call_id)),
    wsService.on('call_ended', (pl) => {
      const { call_id, reason } = pl as { call_id: string; reason: CallEndReason };
      onEnded(call_id, reason);
    }),
    wsService.on('call_error', (pl) => {
      const { code, call_id } = pl as { code: CallErrorCode; call_id?: string };
      onError(code, call_id);
    }),
    wsService.on('call_state', (pl) => onState((pl as { call: CallSnapshot | null }).call)),
  ];

  // Выход из комнаты 1:1 мимо hangup (кнопка в доке/сцене, медиа-сессия,
  // обрыв SFU): leave() — осознанное «Завершить», reset() — сбой.
  // Реагируем только на выход из комнаты, которая была комнатой звонка (prev):
  // при переключении (accept Y из звонка X, вход в канал) join() сначала делает
  // leave() старой комнаты, и подписка видит промежуточное idle + lastExit 'leave'.
  const offRoom = useCallStore.subscribe((s, prev) => {
    if (prev.callKind !== 'direct' || prev.callRoomId === null || s.callRoomId !== null) return;
    const left = prev.callRoomId;
    const p = useDirectCallStore.getState().phase;
    const reason = s.lastExit === 'leave' ? 'ended' : 'failed';
    if (callIdOf(p) === left) {
      if (p.kind !== 'active' && p.kind !== 'connecting') return;
      wsService.send('call_end', { call_id: left, reason });
      finish(p.peer, reason, reason === 'ended');
    }
    // Фаза другого звонка (Y): X при переключении сервер завершает сам
    // (acceptLocked/Start), клиентский call_end дал бы invalid_state.
  });

  // Собеседник пропал из комнаты SFU и не вернулся за grace — звонок сломан.
  const offPeer = useCallStore.subscribe((s, prev) => {
    const p = useDirectCallStore.getState().phase;
    if (p.kind !== 'active') return;
    const had = prev.participants.some((x) => x.userId === p.peer.id);
    const has = s.participants.some((x) => x.userId === p.peer.id);
    if (has) {
      clearPeerLeft();
    } else if (had) {
      armPeerLeft(p.callId);
    }
  });

  return () => {
    offs.forEach((off) => off());
    offRoom();
    offPeer();
    clearPeerLeft();
    if (endingTimer !== null) clearTimeout(endingTimer);
    endingTimer = null;
  };
}

/**
 * Полный сброс при выходе из аккаунта: фаза, пропущенные, ошибка, экран,
 * таймеры и звуки — следующий пользователь не должен увидеть чужой звонок.
 */
export function resetDirectCall(): void {
  stopSounds();
  clearPeerLeft();
  if (endingTimer !== null) clearTimeout(endingTimer);
  endingTimer = null;
  cancelledPeerId = null;
  enteringCallId = null;
  useDirectCallStore.setState({ phase: { kind: 'idle' }, missed: [], viewOpen: false, lastError: null });
}
