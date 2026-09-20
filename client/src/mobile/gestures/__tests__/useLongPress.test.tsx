// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useLongPress } from '@/mobile/gestures/useLongPress';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

const down = (x = 0, y = 0, pointerType = 'touch') => ({ clientX: x, clientY: y, pointerType, button: 0 }) as unknown as React.PointerEvent;
const mouse = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as React.MouseEvent;

describe('useLongPress', () => {
  it('fires after 450ms of holding still', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));
    act(() => result.current.onPointerDown(down()));
    act(() => vi.advanceTimersByTime(449));
    expect(cb).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('is cancelled by moving past the tolerance (scroll)', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));
    act(() => result.current.onPointerDown(down(0, 0)));
    act(() => result.current.onPointerMove(down(0, 9)));
    act(() => vi.advanceTimersByTime(600));
    expect(cb).not.toHaveBeenCalled();
  });

  it('small jitter within tolerance does not cancel', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));
    act(() => result.current.onPointerDown(down(0, 0)));
    act(() => result.current.onPointerMove(down(3, 4)));
    act(() => vi.advanceTimersByTime(450));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('is cancelled by pointerup / pointercancel', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));
    act(() => result.current.onPointerDown(down()));
    act(() => result.current.onPointerUp());
    act(() => result.current.onPointerDown(down()));
    act(() => result.current.onPointerCancel());
    act(() => vi.advanceTimersByTime(1000));
    expect(cb).not.toHaveBeenCalled();
  });

  it('swallows the click that follows a fired long-press, not others', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));
    const plain = mouse();
    result.current.onClickCapture(plain);
    expect(plain.preventDefault).not.toHaveBeenCalled();
    act(() => result.current.onPointerDown(down()));
    act(() => vi.advanceTimersByTime(450));
    const after = mouse();
    result.current.onClickCapture(after);
    expect(after.preventDefault).toHaveBeenCalled();
    expect(after.stopPropagation).toHaveBeenCalled();
  });

  it('suppresses the native context menu on touch only', () => {
    const { result } = renderHook(() => useLongPress(vi.fn()));
    act(() => result.current.onPointerDown(down(0, 0, 'touch')));
    const e = mouse();
    result.current.onContextMenu(e);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('ignores mouse pointers (desktop right-click keeps ContextMenu)', () => {
    const cb = vi.fn();
    const { result } = renderHook(() => useLongPress(cb));
    act(() => result.current.onPointerDown(down(0, 0, 'mouse')));
    act(() => vi.advanceTimersByTime(1000));
    expect(cb).not.toHaveBeenCalled();
  });
});
