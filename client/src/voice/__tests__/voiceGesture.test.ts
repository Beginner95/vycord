import { describe, it, expect } from 'vitest';
import { reduce, IDLE, LOCK_DY, CANCEL_DX, MIN_MS, MAX_MS, type GestureState, type GestureEvent } from '@/voice/voiceGesture';

function run(events: GestureEvent[], from: GestureState = IDLE) {
  let state = from;
  const effects = [];
  for (const e of events) {
    const r = reduce(state, e);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}

const press = { type: 'press', x: 100, y: 100, inCall: false } as const;
const started = { type: 'recorderStarted', t: 0 } as const;

describe('voiceGesture', () => {
  it('press запускает рекордер', () => {
    expect(run([press])).toEqual({ state: { kind: 'starting', origin: { x: 100, y: 100 }, keyboard: false }, effects: [{ type: 'startRecorder' }] });
  });

  it('press во время звонка — подсказка, запись не стартует', () => {
    expect(run([{ ...press, inCall: true }])).toEqual({ state: IDLE, effects: [{ type: 'hint', hint: 'call' }] });
  });

  it('отпустил до старта рекордера (короткий клик) — discard + hold', () => {
    const r = run([press, { type: 'release', t: 50 }]);
    expect(r.state).toEqual(IDLE);
    expect(r.effects).toEqual([{ type: 'startRecorder' }, { type: 'discard' }, { type: 'hint', hint: 'hold' }]);
  });

  it('удержание ≥ MIN_MS и отпускание — send', () => {
    const r = run([press, started, { type: 'release', t: MIN_MS }]);
    expect(r.state).toEqual(IDLE);
    expect(r.effects[r.effects.length - 1]).toEqual({ type: 'send' });
  });

  it('удержание < MIN_MS — discard + hold', () => {
    const r = run([press, started, { type: 'release', t: MIN_MS - 1 }]);
    expect(r.effects.slice(-2)).toEqual([{ type: 'discard' }, { type: 'hint', hint: 'hold' }]);
  });

  it('свайп вверх за порог — locked, release игнорируется', () => {
    const r = run([press, started, { type: 'move', x: 100, y: 100 - LOCK_DY }, { type: 'release', t: 5000 }]);
    expect(r.state).toEqual({ kind: 'locked', startedAt: 0 });
    expect(r.effects).toEqual([{ type: 'startRecorder' }]);
  });

  it('свайп влево за порог — discard сразу, до отпускания', () => {
    const r = run([press, started, { type: 'move', x: 100 - CANCEL_DX, y: 100 }]);
    expect(r.state).toEqual(IDLE);
    expect(r.effects[r.effects.length - 1]).toEqual({ type: 'discard' });
  });

  it('оба порога одним событием — отмена приоритетнее', () => {
    const r = run([press, started, { type: 'move', x: 100 - CANCEL_DX, y: 100 - LOCK_DY }]);
    expect(r.state).toEqual(IDLE);
    expect(r.effects[r.effects.length - 1]).toEqual({ type: 'discard' });
  });

  it('move до порога обновляет dx (только влево, не положительный)', () => {
    expect(run([press, started, { type: 'move', x: 70, y: 100 }]).state).toMatchObject({ kind: 'recording', dx: -30 });
    expect(run([press, started, { type: 'move', x: 150, y: 100 }]).state).toMatchObject({ kind: 'recording', dx: 0 });
  });

  it('tick на MAX_MS отправляет из recording и из locked', () => {
    const recordingEffects = run([press, started, { type: 'tick', t: MAX_MS }]).effects;
    expect(recordingEffects[recordingEffects.length - 1]).toEqual({ type: 'send' });
    expect(run([{ type: 'tick', t: MAX_MS }], { kind: 'locked', startedAt: 0 }).effects).toEqual([{ type: 'send' }]);
    expect(run([{ type: 'tick', t: MAX_MS - 1 }], { kind: 'locked', startedAt: 0 }).effects).toEqual([]);
  });

  it('interrupt при удержании — discard + interrupted; в locked — игнор', () => {
    expect(run([press, started, { type: 'interrupt' }]).effects.slice(-2)).toEqual([{ type: 'discard' }, { type: 'hint', hint: 'interrupted' }]);
    expect(run([press, { type: 'interrupt' }]).state).toEqual(IDLE);
    const locked: GestureState = { kind: 'locked', startedAt: 0 };
    expect(run([{ type: 'interrupt' }], locked)).toEqual({ state: locked, effects: [] });
  });

  it('recorderFailed — idle + подсказка с причиной', () => {
    expect(run([press, { type: 'recorderFailed', reason: 'mic_denied' }])).toEqual({
      state: IDLE, effects: [{ type: 'startRecorder' }, { type: 'hint', hint: 'mic_denied' }],
    });
  });

  it('клавиатура: keyboardStart → starting(keyboard) → locked', () => {
    const r = run([{ type: 'keyboardStart', inCall: false }, { type: 'recorderStarted', t: 10 }]);
    expect(r.state).toEqual({ kind: 'locked', startedAt: 10 });
  });

  it('клавиатура в звонке — подсказка', () => {
    expect(run([{ type: 'keyboardStart', inCall: true }]).effects).toEqual([{ type: 'hint', hint: 'call' }]);
  });

  it('locked: send (≥ MIN_MS), delete, короткий send → hold', () => {
    const locked: GestureState = { kind: 'locked', startedAt: 0 };
    expect(run([{ type: 'lockedSend', t: MIN_MS }], locked)).toEqual({ state: IDLE, effects: [{ type: 'send' }] });
    expect(run([{ type: 'lockedDelete' }], locked)).toEqual({ state: IDLE, effects: [{ type: 'discard' }] });
    expect(run([{ type: 'lockedSend', t: 10 }], locked).effects).toEqual([{ type: 'discard' }, { type: 'hint', hint: 'hold' }]);
  });

  it('посторонние события в idle ничего не делают', () => {
    for (const e of [{ type: 'release', t: 1 }, { type: 'move', x: 0, y: 0 }, { type: 'interrupt' }, { type: 'tick', t: MAX_MS }, { type: 'recorderStarted', t: 0 }] as GestureEvent[]) {
      expect(run([e])).toEqual({ state: IDLE, effects: [] });
    }
  });

  it('повторный press во время записи игнорируется', () => {
    const s = run([press, started]).state;
    expect(run([press], s)).toEqual({ state: s, effects: [] });
  });
});
