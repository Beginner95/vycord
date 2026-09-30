/**
 * Жест голосового (VYC-101, spec §2.1) — чистая state machine без React и DOM.
 * Хук useVoiceRecording переводит pointer/keyboard/window-события в события
 * этой машины и исполняет возвращённые эффекты.
 */

export const LOCK_DY = 60;
export const CANCEL_DX = 100;
export const MIN_MS = 1000;
export const MAX_MS = 900_000;

export type RecorderFailure = 'mic_denied' | 'mic_not_found' | 'mic_failed';
export type HintKind = 'hold' | 'call' | 'interrupted' | RecorderFailure;
export interface Point {
  x: number;
  y: number;
}
export type GestureState =
  | { kind: 'idle' }
  | { kind: 'starting'; origin: Point | null; keyboard: boolean }
  | { kind: 'recording'; origin: Point; startedAt: number; dx: number }
  | { kind: 'locked'; startedAt: number };
export type GestureEvent =
  | { type: 'press'; x: number; y: number; inCall: boolean }
  | { type: 'keyboardStart'; inCall: boolean }
  | { type: 'move'; x: number; y: number }
  | { type: 'release'; t: number }
  | { type: 'interrupt' }
  | { type: 'recorderStarted'; t: number }
  | { type: 'recorderFailed'; reason: RecorderFailure }
  | { type: 'tick'; t: number }
  | { type: 'lockedSend'; t: number }
  | { type: 'lockedDelete' };
export type GestureEffect =
  | { type: 'startRecorder' }
  | { type: 'send' }
  | { type: 'discard' }
  | { type: 'hint'; hint: HintKind };

export const IDLE: GestureState = { kind: 'idle' };

const none = (state: GestureState) => ({ state, effects: [] as GestureEffect[] });
const to = (state: GestureState, ...effects: GestureEffect[]) => ({ state, effects });
const hint = (h: HintKind): GestureEffect => ({ type: 'hint', hint: h });

export function reduce(state: GestureState, event: GestureEvent): { state: GestureState; effects: GestureEffect[] } {
  switch (state.kind) {
    case 'idle':
      if (event.type === 'press') {
        if (event.inCall) return to(IDLE, hint('call'));
        return to({ kind: 'starting', origin: { x: event.x, y: event.y }, keyboard: false }, { type: 'startRecorder' });
      }
      if (event.type === 'keyboardStart') {
        if (event.inCall) return to(IDLE, hint('call'));
        return to({ kind: 'starting', origin: null, keyboard: true }, { type: 'startRecorder' });
      }
      return none(state);

    case 'starting':
      switch (event.type) {
        case 'recorderStarted':
          return state.keyboard || !state.origin
            ? none({ kind: 'locked', startedAt: event.t })
            : none({ kind: 'recording', origin: state.origin, startedAt: event.t, dx: 0 });
        case 'recorderFailed':
          return to(IDLE, hint(event.reason));
        case 'release':
          // Клавиатурный старт release не получает; для указателя это
          // короткий клик или отпускание во время запроса разрешения.
          return state.keyboard ? none(state) : to(IDLE, { type: 'discard' }, hint('hold'));
        case 'interrupt':
          return to(IDLE, { type: 'discard' }, hint('interrupted'));
        default:
          return none(state);
      }

    case 'recording':
      switch (event.type) {
        case 'move': {
          const dx = event.x - state.origin.x;
          const dy = event.y - state.origin.y;
          if (dx <= -CANCEL_DX) return to(IDLE, { type: 'discard' });
          if (dy <= -LOCK_DY) return none({ kind: 'locked', startedAt: state.startedAt });
          return none({ ...state, dx: Math.min(0, dx) });
        }
        case 'release':
          return event.t - state.startedAt < MIN_MS
            ? to(IDLE, { type: 'discard' }, hint('hold'))
            : to(IDLE, { type: 'send' });
        case 'tick':
          return event.t - state.startedAt >= MAX_MS ? to(IDLE, { type: 'send' }) : none(state);
        case 'interrupt':
          return to(IDLE, { type: 'discard' }, hint('interrupted'));
        case 'recorderFailed':
          return to(IDLE, hint(event.reason));
        default:
          return none(state);
      }

    case 'locked':
      switch (event.type) {
        case 'tick':
          return event.t - state.startedAt >= MAX_MS ? to(IDLE, { type: 'send' }) : none(state);
        case 'lockedSend':
          return event.t - state.startedAt < MIN_MS
            ? to(IDLE, { type: 'discard' }, hint('hold'))
            : to(IDLE, { type: 'send' });
        case 'lockedDelete':
          return to(IDLE, { type: 'discard' });
        case 'recorderFailed':
          return to(IDLE, hint(event.reason));
        default:
          // interrupt и release в закреплённой записи игнорируются намеренно.
          return none(state);
      }
  }
}
