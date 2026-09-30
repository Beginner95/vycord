import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { callService } from '@/services/call';
import { useCallStore } from '@/stores/callStore';
import { pauseCurrent } from '@/utils/chatMediaCoordinator';
import { IDLE, reduce, type GestureEvent, type GestureState, type HintKind } from '@/voice/voiceGesture';
import { startVoiceRecorder, toRecorderFailure, type VoiceRecorderHandle, type VoiceRecording } from '@/voice/voiceRecorder';

const TICK_MS = 200;
const HINT_MS = 2500;

const defaultInCall = () => useCallStore.getState().callChannelId !== null || callService.isInCallState;

export interface UseVoiceRecording {
  state: GestureState;
  elapsedMs: number;
  /** 0..1 */
  level: number;
  hint: HintKind | null;
  micProps: {
    onPointerDown(e: PointerEvent<HTMLButtonElement>): void;
    onPointerMove(e: PointerEvent<HTMLButtonElement>): void;
    onPointerUp(e: PointerEvent<HTMLButtonElement>): void;
    onPointerCancel(): void;
    onKeyDown(e: KeyboardEvent<HTMLButtonElement>): void;
    onClick(e: MouseEvent<HTMLButtonElement>): void;
    onContextMenu(e: MouseEvent): void;
  };
  lockedSend(): void;
  lockedDelete(): void;
}

/** Связка жест ↔ рекордер ↔ DOM (spec §2.3). Вся логика переходов — в voiceGesture. */
export function useVoiceRecording({ channelId, onSend, start = startVoiceRecorder, isInCall = defaultInCall }: {
  channelId: string; onSend(r: VoiceRecording): void; start?: typeof startVoiceRecorder; isInCall?: () => boolean;
}): UseVoiceRecording {
  const [state, setState] = useState<GestureState>(IDLE);
  const [elapsedMs, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [hint, setHint] = useState<HintKind | null>(null);
  const stateRef = useRef<GestureState>(IDLE);
  const handleRef = useRef<VoiceRecorderHandle | null>(null);
  // Поколение старта: запоздавший getUserMedia старого поколения освобождается сразу.
  const genRef = useRef(0);
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showHint = useCallback((h: HintKind) => {
    setHint(h);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), HINT_MS);
  }, []);

  const dispatch = useCallback((event: GestureEvent) => {
    const { state: next, effects } = reduce(stateRef.current, event);
    stateRef.current = next;
    setState(next);
    for (const fx of effects) {
      switch (fx.type) {
        case 'startRecorder': {
          const gen = ++genRef.current;
          pauseCurrent();
          start().then(
            (h) => {
              // Отпустил/отменил/сменил канал, пока открывался микрофон — трек освобождаем сразу.
              if (gen !== genRef.current || stateRef.current.kind !== 'starting') { h.discard(); return; }
              handleRef.current = h;
              dispatch({ type: 'recorderStarted', t: performance.now() });
            },
            (err: unknown) => { if (gen === genRef.current) dispatch({ type: 'recorderFailed', reason: toRecorderFailure(err) }); },
          );
          break;
        }
        case 'discard':
          genRef.current++;
          handleRef.current?.discard();
          handleRef.current = null;
          break;
        case 'send': {
          genRef.current++;
          const h = handleRef.current;
          handleRef.current = null;
          h?.stop().then((r) => onSendRef.current(r), () => showHint('mic_failed'));
          break;
        }
        case 'hint':
          showHint(fx.hint);
          break;
      }
    }
  }, [start, showHint]);

  const active = state.kind !== 'idle';
  const recordingLike = state.kind === 'recording' || state.kind === 'locked';
  const startedAt = recordingLike ? state.startedAt : 0;

  // Таймер/уровень/лимит — только пока идёт запись.
  useEffect(() => {
    if (!recordingLike) { setElapsed(0); setLevel(0); return; }
    const id = setInterval(() => {
      const t = performance.now();
      setElapsed(t - startedAt);
      setLevel(handleRef.current?.level() ?? 0);
      dispatch({ type: 'tick', t });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [recordingLike, startedAt, dispatch]);

  // Потеря фокуса/скрытие вкладки — interrupt (в locked машина его игнорирует).
  useEffect(() => {
    if (!active) return;
    const onBlur = () => dispatch({ type: 'interrupt' });
    const onVis = () => { if (document.visibilityState === 'hidden') dispatch({ type: 'interrupt' }); };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('blur', onBlur); document.removeEventListener('visibilitychange', onVis); };
  }, [active, dispatch]);

  // Смена канала и размонтирование — запись не должна уехать не туда.
  // Cleanup эффекта с [channelId] срабатывает в обоих случаях.
  useEffect(() => () => {
    if (stateRef.current.kind !== 'idle') {
      genRef.current++;
      handleRef.current?.discard();
      handleRef.current = null;
      stateRef.current = IDLE;
      setState(IDLE);
    }
  }, [channelId]);
  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);

  const micProps: UseVoiceRecording['micProps'] = {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      dispatch({ type: 'press', x: e.clientX, y: e.clientY, inCall: isInCall() });
    },
    onPointerMove: (e) => dispatch({ type: 'move', x: e.clientX, y: e.clientY }),
    onPointerUp: () => dispatch({ type: 'release', t: performance.now() }),
    onPointerCancel: () => dispatch({ type: 'interrupt' }),
    onKeyDown: (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (e.repeat) return;
      dispatch({ type: 'keyboardStart', inCall: isInCall() });
    },
    // Клик мышью уже обработан pointer-событиями; click от клавиатуры (detail=0)
    // после keyup пробела — тоже. Сам по себе click ничего не делает.
    onClick: (e) => e.preventDefault(),
    onContextMenu: (e) => e.preventDefault(),
  };

  return {
    state, elapsedMs, level, hint, micProps,
    lockedSend: () => dispatch({ type: 'lockedSend', t: performance.now() }),
    lockedDelete: () => dispatch({ type: 'lockedDelete' }),
  };
}
