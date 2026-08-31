// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useRef } from 'react';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { useEscapeDismiss, useModalFocus, isBlockingOverlayOpen } from '@/hooks/useModalFocus';

/**
 * M6 T11's surface stack, covered where it actually lives.
 *
 * The +129-line stack rewrite and the five re-routed surfaces were verified only
 * by a CDP probe under `.superpowers/`, which is gitignored and gated by nothing
 * (see client/docs/verification.md). `layerStack` is pure module state plus one `document`
 * keydown listener, so the ordering rules are cheap to pin down here — and they
 * are the part most likely to rot silently, because getting them wrong produces
 * no error, no type failure and no visual difference.
 *
 * Deliberately bounded to the stack's contract: push/pop/top ordering, the
 * out-of-order removal that `popLayer`'s `findIndex === -1` guard protects, that
 * a re-render must not promote a layer, and which layers raise
 * `isBlockingOverlayOpen()`. Focus-trap and portal behaviour stay in the probes,
 * where a real layout engine can answer them.
 */

function LightLayer({ onEscape, active = true, blocking = false }: {
  onEscape: () => void; active?: boolean; blocking?: boolean;
}) {
  useEscapeDismiss(active, onEscape, blocking);
  return null;
}

function ModalLayer({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(true, ref, onClose);
  return <div ref={ref}><button type="button">ok</button></div>;
}

const escape = () => fireEvent.keyDown(document, { key: 'Escape' });

afterEach(cleanup);

describe('surface stack — Escape ordering', () => {
  it('Escape reaches only the top-most layer, then the one below it', () => {
    const bottom = vi.fn();
    const top = vi.fn();
    const a = render(<LightLayer onEscape={bottom} />);
    // A separate render() is what makes `top` land ABOVE `bottom`: layers are
    // ordered by activation, and this effect runs second.
    const b = render(<LightLayer onEscape={top} />);

    escape();
    expect(top).toHaveBeenCalledTimes(1);
    expect(bottom).not.toHaveBeenCalled();

    b.unmount();
    escape();
    expect(top).toHaveBeenCalledTimes(1);
    expect(bottom).toHaveBeenCalledTimes(1);

    a.unmount();
    escape();
    expect(bottom).toHaveBeenCalledTimes(1);
  });

  it('removing a MIDDLE layer leaves the rest of the order intact', () => {
    // This is the reachable form of `popLayer`'s `findIndex === -1` guard. The
    // shape it replaced — `splice(indexOf(token), 1)` — removes the LAST element
    // on a miss, so a wrong removal here silently hands Escape to the wrong
    // surface with no error of any kind.
    const bottom = vi.fn();
    const middle = vi.fn();
    const top = vi.fn();
    const a = render(<LightLayer onEscape={bottom} />);
    const b = render(<LightLayer onEscape={middle} />);
    const c = render(<LightLayer onEscape={top} />);

    b.unmount();
    escape();
    expect(top).toHaveBeenCalledTimes(1);
    expect(middle).not.toHaveBeenCalled();
    expect(bottom).not.toHaveBeenCalled();

    c.unmount();
    escape();
    expect(bottom).toHaveBeenCalledTimes(1);
    expect(middle).not.toHaveBeenCalled();

    a.unmount();
  });

  it('a re-render with a fresh callback identity does not promote the layer', () => {
    // ContextMenu recreates onClose on every parent render. With deps of
    // [onEscape] the layer would pop and re-push to the TOP on each one and
    // steal Escape from a modal above it.
    const bottom = vi.fn();
    const top = vi.fn();
    const a = render(<LightLayer onEscape={() => bottom()} />);
    const b = render(<LightLayer onEscape={() => top()} />);

    // Re-render the BOTTOM layer with a brand-new closure.
    a.rerender(<LightLayer onEscape={() => bottom()} />);
    escape();
    expect(top).toHaveBeenCalledTimes(1);
    expect(bottom).not.toHaveBeenCalled();

    b.unmount();
    a.unmount();
  });

  it('the latest callback is used, even though the subscription binds once', () => {
    const first = vi.fn();
    const second = vi.fn();
    const a = render(<LightLayer onEscape={first} />);
    a.rerender(<LightLayer onEscape={second} />);
    escape();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    a.unmount();
  });

  it('an inactive layer is not on the stack at all', () => {
    const inactive = vi.fn();
    const active = vi.fn();
    const a = render(<LightLayer onEscape={active} />);
    const b = render(<LightLayer onEscape={inactive} active={false} />);

    escape();
    expect(inactive).not.toHaveBeenCalled();
    expect(active).toHaveBeenCalledTimes(1);

    b.unmount();
    a.unmount();
  });

  it('a modal opened over a light layer takes Escape first', () => {
    const light = vi.fn();
    const modal = vi.fn();
    const a = render(<LightLayer onEscape={light} />);
    const b = render(<ModalLayer onClose={modal} />);

    escape();
    expect(modal).toHaveBeenCalledTimes(1);
    expect(light).not.toHaveBeenCalled();

    b.unmount();
    escape();
    expect(light).toHaveBeenCalledTimes(1);
    a.unmount();
  });
});

describe('surface stack — isBlockingOverlayOpen()', () => {
  it('is false with nothing open', () => {
    expect(isBlockingOverlayOpen()).toBe(false);
  });

  it('a NON-blocking layer does not raise it (context menus must not swallow ⌘K)', () => {
    const a = render(<LightLayer onEscape={() => {}} />);
    expect(isBlockingOverlayOpen()).toBe(false);
    a.unmount();
  });

  it('a blocking layer raises it, and lowers it again on unmount', () => {
    const a = render(<LightLayer onEscape={() => {}} blocking />);
    expect(isBlockingOverlayOpen()).toBe(true);
    a.unmount();
    expect(isBlockingOverlayOpen()).toBe(false);
  });

  it('useModalFocus registers as blocking', () => {
    const a = render(<ModalLayer onClose={() => {}} />);
    expect(isBlockingOverlayOpen()).toBe(true);
    a.unmount();
    expect(isBlockingOverlayOpen()).toBe(false);
  });

  it('the DOM half still counts a scrim the stack knows nothing about', () => {
    // The half CF-4b showed is load-bearing: a class alone satisfies the gate.
    const el = document.createElement('div');
    el.className = 'p2p-overlay is-incoming';
    act(() => { document.body.appendChild(el); });
    expect(isBlockingOverlayOpen()).toBe(true);
    el.remove();
    expect(isBlockingOverlayOpen()).toBe(false);
  });
});
