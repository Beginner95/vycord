// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceRecording } from '@/hooks/useVoiceRecording';
import type { VoiceRecorderHandle } from '@/voice/voiceRecorder';

function deferredHandle() {
  const handle: VoiceRecorderHandle = {
    level: () => 0.3,
    stop: vi.fn(async () => ({ blob: new Blob(['x']), mimeType: 'audio/webm', durationMs: 2000, waveform: new Array(64).fill(1) })),
    discard: vi.fn(),
  };
  let resolve!: (h: VoiceRecorderHandle) => void;
  const promise = new Promise<VoiceRecorderHandle>((r) => { resolve = r; });
  return { handle, start: vi.fn(() => promise), resolve: () => resolve(handle) };
}

const ptr = (x: number, y: number, pointerId = 1) => ({ clientX: x, clientY: y, pointerId, button: 0, currentTarget: { setPointerCapture: vi.fn() }, preventDefault: vi.fn() }) as never;

describe('useVoiceRecording', () => {
  let now = 0;
  beforeEach(() => { now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now); vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] }); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('удержание → отпускание → onSend', async () => {
    const d = deferredHandle(); const onSend = vi.fn();
    const { result } = renderHook(() => useVoiceRecording({ channelId: 'a', onSend, start: d.start, isInCall: () => false }));
    act(() => result.current.micProps.onPointerDown(ptr(100, 100)));
    await act(async () => { d.resolve(); });
    expect(result.current.state.kind).toBe('recording');
    now = 2000;
    await act(async () => { result.current.micProps.onPointerUp(ptr(100, 100)); });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(result.current.state.kind).toBe('idle');
  });

  it('late start is released: отпустил до старта рекордера', async () => {
    const d = deferredHandle(); const onSend = vi.fn();
    const { result } = renderHook(() => useVoiceRecording({ channelId: 'a', onSend, start: d.start, isInCall: () => false }));
    act(() => result.current.micProps.onPointerDown(ptr(100, 100)));
    act(() => result.current.micProps.onPointerUp(ptr(100, 100)));
    expect(result.current.hint).toBe('hold');
    await act(async () => { d.resolve(); });
    expect(d.handle.discard).toHaveBeenCalled();
    expect(result.current.state.kind).toBe('idle');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('channel change discards', async () => {
    const d = deferredHandle(); const onSend = vi.fn();
    const { result, rerender } = renderHook(({ ch }) => useVoiceRecording({ channelId: ch, onSend, start: d.start, isInCall: () => false }), { initialProps: { ch: 'a' } });
    act(() => result.current.micProps.onPointerDown(ptr(100, 100)));
    await act(async () => { d.resolve(); });
    rerender({ ch: 'b' });
    expect(d.handle.discard).toHaveBeenCalled();
    expect(result.current.state.kind).toBe('idle');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keyboard start once: автоповтор и click после keyup не дублируют', async () => {
    const d = deferredHandle();
    const { result } = renderHook(() => useVoiceRecording({ channelId: 'a', onSend: vi.fn(), start: d.start, isInCall: () => false }));
    const key = (repeat: boolean) => ({ key: ' ', repeat, preventDefault: vi.fn() }) as never;
    act(() => result.current.micProps.onKeyDown(key(false)));
    act(() => result.current.micProps.onKeyDown(key(true)));
    act(() => result.current.micProps.onClick({ detail: 0, preventDefault: vi.fn() } as never));
    await act(async () => { d.resolve(); });
    expect(d.start).toHaveBeenCalledTimes(1);
    expect(result.current.state.kind).toBe('locked');
    expect(result.current.hint).toBeNull();
  });

  it('в звонке — подсказка, рекордер не стартует', () => {
    const d = deferredHandle();
    const { result } = renderHook(() => useVoiceRecording({ channelId: 'a', onSend: vi.fn(), start: d.start, isInCall: () => true }));
    act(() => result.current.micProps.onPointerDown(ptr(100, 100)));
    expect(d.start).not.toHaveBeenCalled();
    expect(result.current.hint).toBe('call');
  });

  it('blur окна во время удержания — отмена и освобождение', async () => {
    const d = deferredHandle();
    const { result } = renderHook(() => useVoiceRecording({ channelId: 'a', onSend: vi.fn(), start: d.start, isInCall: () => false }));
    act(() => result.current.micProps.onPointerDown(ptr(100, 100)));
    await act(async () => { d.resolve(); });
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(d.handle.discard).toHaveBeenCalled();
    expect(result.current.hint).toBe('interrupted');
  });

  it('размонтирование во время записи освобождает', async () => {
    const d = deferredHandle();
    const { result, unmount } = renderHook(() => useVoiceRecording({ channelId: 'a', onSend: vi.fn(), start: d.start, isInCall: () => false }));
    act(() => result.current.micProps.onPointerDown(ptr(100, 100)));
    await act(async () => { d.resolve(); });
    unmount();
    expect(d.handle.discard).toHaveBeenCalled();
  });

  it('лимит 15 минут отправляет', async () => {
    const d = deferredHandle(); const onSend = vi.fn();
    const { result } = renderHook(() => useVoiceRecording({ channelId: 'a', onSend, start: d.start, isInCall: () => false }));
    act(() => result.current.micProps.onPointerDown(ptr(100, 100)));
    await act(async () => { d.resolve(); });
    now = 900_000;
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
  it('send уходит в канал, где запись закончена, даже если канал сменился до stop()', async () => {
    const d = deferredHandle();
    const rec = { blob: new Blob(['x']), mimeType: 'audio/webm', durationMs: 2000, waveform: new Array(64).fill(1) };
    let finish!: () => void;
    d.handle.stop = vi.fn(() => new Promise<typeof rec>((r) => { finish = () => r(rec); }));
    const onSendA = vi.fn(); const onSendB = vi.fn();
    const { result, rerender } = renderHook(({ ch, onSend }) => useVoiceRecording({ channelId: ch, onSend, start: d.start, isInCall: () => false }), { initialProps: { ch: 'a', onSend: onSendA } });
    act(() => result.current.micProps.onPointerDown(ptr(100, 100)));
    await act(async () => { d.resolve(); });
    now = 2000;
    act(() => result.current.micProps.onPointerUp(ptr(100, 100)));
    rerender({ ch: 'b', onSend: onSendB });
    await act(async () => { finish(); });
    expect(onSendA).toHaveBeenCalledWith(rec);
    expect(onSendB).not.toHaveBeenCalled();
  });

  it('blur во время клавиатурного starting (диалог разрешения) не прерывает', async () => {
    const d = deferredHandle();
    const { result } = renderHook(() => useVoiceRecording({ channelId: 'a', onSend: vi.fn(), start: d.start, isInCall: () => false }));
    act(() => result.current.micProps.onKeyDown({ key: 'Enter', repeat: false, preventDefault: vi.fn() } as never));
    act(() => { window.dispatchEvent(new Event('blur')); });
    await act(async () => { d.resolve(); });
    expect(d.handle.discard).not.toHaveBeenCalled();
    expect(result.current.state.kind).toBe('locked');
    expect(result.current.hint).toBeNull();
  });

  it('мультитач: второй палец не управляет жестом, первый отправляет', async () => {
    const d = deferredHandle(); const onSend = vi.fn();
    const { result } = renderHook(() => useVoiceRecording({ channelId: 'a', onSend, start: d.start, isInCall: () => false }));
    act(() => result.current.micProps.onPointerDown(ptr(100, 100, 1)));
    await act(async () => { d.resolve(); });
    const second = ptr(100, 100, 2);
    act(() => result.current.micProps.onPointerDown(second));
    expect((second as unknown as { currentTarget: { setPointerCapture: () => void } }).currentTarget.setPointerCapture).not.toHaveBeenCalled();
    now = 1500;
    act(() => result.current.micProps.onPointerUp(ptr(100, 100, 2)));
    expect(result.current.state.kind).toBe('recording');
    expect(onSend).not.toHaveBeenCalled();
    now = 2000;
    await act(async () => { result.current.micProps.onPointerUp(ptr(100, 100, 1)); });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('мультитач: движение и cancel чужого пальца не отменяют запись', async () => {
    const d = deferredHandle(); const onSend = vi.fn();
    const { result } = renderHook(() => useVoiceRecording({ channelId: 'a', onSend, start: d.start, isInCall: () => false }));
    act(() => result.current.micProps.onPointerDown(ptr(300, 100, 1)));
    await act(async () => { d.resolve(); });
    act(() => result.current.micProps.onPointerMove(ptr(-500, 100, 2)));
    act(() => result.current.micProps.onPointerCancel(ptr(0, 0, 2)));
    expect(result.current.state.kind).toBe('recording');
    expect(d.handle.discard).not.toHaveBeenCalled();
    act(() => result.current.micProps.onPointerCancel(ptr(0, 0, 1)));
    expect(result.current.state.kind).toBe('idle');
    // после возврата в idle новый жест принимается любым пальцем
    act(() => result.current.micProps.onPointerDown(ptr(100, 100, 7)));
    expect(result.current.state.kind).toBe('starting');
  });

  describe('отклик (вибрация/звук)', () => {
    const setup = () => {
      const d = deferredHandle(); const onSend = vi.fn(); const feedback = vi.fn();
      const r = renderHook(() => useVoiceRecording({ channelId: 'a', onSend, start: d.start, isInCall: () => false, feedback }));
      return { d, onSend, feedback, result: r.result };
    };

    it('старт записи → start, отпускание после 1 с → send', async () => {
      const { d, feedback, result } = setup();
      act(() => result.current.micProps.onPointerDown(ptr(100, 100)));
      expect(feedback).not.toHaveBeenCalled();
      await act(async () => { d.resolve(); });
      expect(feedback).toHaveBeenLastCalledWith('start');
      now = 2000;
      await act(async () => { result.current.micProps.onPointerUp(ptr(100, 100)); });
      expect(feedback.mock.calls.map((c) => c[0])).toEqual(['start', 'send']);
    });

    it('свайп влево → cancel', async () => {
      const { d, feedback, result } = setup();
      act(() => result.current.micProps.onPointerDown(ptr(300, 100)));
      await act(async () => { d.resolve(); });
      act(() => result.current.micProps.onPointerMove(ptr(150, 100)));
      expect(feedback.mock.calls.map((c) => c[0])).toEqual(['start', 'cancel']);
    });

    it('отпустил раньше 1 с после старта → cancel', async () => {
      const { d, feedback, result } = setup();
      act(() => result.current.micProps.onPointerDown(ptr(100, 100)));
      await act(async () => { d.resolve(); });
      now = 500;
      act(() => result.current.micProps.onPointerUp(ptr(100, 100)));
      expect(feedback.mock.calls.map((c) => c[0])).toEqual(['start', 'cancel']);
    });

    it('вверх → lock, затем «Отправить» → send', async () => {
      const { d, feedback, result } = setup();
      act(() => result.current.micProps.onPointerDown(ptr(100, 300)));
      await act(async () => { d.resolve(); });
      act(() => result.current.micProps.onPointerMove(ptr(100, 200)));
      now = 2000;
      await act(async () => { result.current.lockedSend(); });
      expect(feedback.mock.calls.map((c) => c[0])).toEqual(['start', 'lock', 'send']);
    });

    it('короткий клик до старта рекордера — без отклика', async () => {
      const { d, feedback, result } = setup();
      act(() => result.current.micProps.onPointerDown(ptr(100, 100)));
      act(() => result.current.micProps.onPointerUp(ptr(100, 100)));
      await act(async () => { d.resolve(); });
      expect(feedback).not.toHaveBeenCalled();
    });
  });
});
