// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useRef } from 'react';
import { keyboardInset, useVisualViewportInset, KEYBOARD_INSET_VAR } from '@/mobile/keyboard';

describe('keyboardInset', () => {
  it('is what the visual viewport lost, minus its scroll offset', () => {
    expect(keyboardInset({ height: 500, offsetTop: 0 }, 844)).toBe(344);
    expect(keyboardInset({ height: 500, offsetTop: 40 }, 844)).toBe(304);
  });
  it('treats a small delta (collapsing URL bar) as no keyboard', () => {
    expect(keyboardInset({ height: 800, offsetTop: 0 }, 844)).toBe(0);
  });
  it('never goes negative', () => {
    expect(keyboardInset({ height: 900, offsetTop: 0 }, 844)).toBe(0);
  });
});

function setViewport(vv: unknown, innerHeight = 844) {
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight });
}
function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  useVisualViewportInset(ref);
  return <div ref={ref} data-testid="shell" />;
}
afterEach(() => { cleanup(); setViewport(undefined); });

describe('useVisualViewportInset', () => {
  it('writes the property, follows resize/scroll and clears it on unmount', () => {
    const vv = Object.assign(new EventTarget(), { height: 500, offsetTop: 0 });
    setViewport(vv);
    const { getByTestId, unmount } = render(<Probe />);
    const el = getByTestId('shell');
    expect(el.style.getPropertyValue(KEYBOARD_INSET_VAR)).toBe('344px');
    act(() => { vv.height = 844; vv.dispatchEvent(new Event('resize')); });
    expect(el.style.getPropertyValue(KEYBOARD_INSET_VAR)).toBe('0px');
    act(() => { vv.height = 600; vv.offsetTop = 20; vv.dispatchEvent(new Event('scroll')); });
    expect(el.style.getPropertyValue(KEYBOARD_INSET_VAR)).toBe('224px');
    unmount();
    expect(el.style.getPropertyValue(KEYBOARD_INSET_VAR)).toBe('');
  });
  it('does nothing without visualViewport', () => {
    setViewport(undefined);
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('shell').style.getPropertyValue(KEYBOARD_INSET_VAR)).toBe('');
  });
});
