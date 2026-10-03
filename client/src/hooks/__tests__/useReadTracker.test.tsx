// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useRef } from 'react';
import { useReadTracker } from '../useReadTracker';
import { useMessageStore, type ChatMessage } from '@/stores/messageStore';
import { useUnreadStore } from '@/stores/unreadStore';

vi.mock('@/services/api', () => ({ apiService: {} }));

type Entry = Pick<IntersectionObserverEntry, 'target' | 'isIntersecting' | 'intersectionRatio' | 'boundingClientRect' | 'rootBounds'>;
let ioCallback: ((entries: Entry[]) => void) | null = null;
class FakeIO {
  constructor(cb: (entries: Entry[]) => void) { ioCallback = cb; }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

const msg = (id: string, at: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, channel_id: 'c1', user_id: 'u2', content: 'x', kind: 'user', created_at: at, updated_at: at, ...extra,
});

function Probe({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useReadTracker('c1', ref, enabled);
  const messages = useMessageStore((s) => s.messages);
  return <div ref={ref}>{messages.map((m) => <div key={m.id} data-message-id={m.id} />)}</div>;
}

const entry = (id: string, visible: boolean): Entry => ({
  target: document.querySelector(`[data-message-id="${id}"]`)!,
  isIntersecting: visible,
  intersectionRatio: visible ? 1 : 0,
  boundingClientRect: { bottom: 100 } as DOMRectReadOnly,
  rootBounds: { bottom: 500 } as DOMRectReadOnly,
});
const see = (...ids: string[]) => act(() => { ioCallback!(ids.map((id) => entry(id, true))); });
const hide = (...ids: string[]) => act(() => { ioCallback!(ids.map((id) => entry(id, false))); });

let focused = true;
const markRead = vi.fn();

beforeEach(() => {
  ioCallback = null;
  focused = true;
  markRead.mockReset();
  vi.stubGlobal('IntersectionObserver', FakeIO);
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  useUnreadStore.setState({ markRead });
  useMessageStore.setState({
    messages: [
      msg('m1', '2026-10-03T10:00:00.000001Z'),
      msg('m2', '2026-10-03T10:00:01Z'),
      msg('call', '2026-10-03T10:00:02Z', { kind: 'call' }),
      msg('p', '2026-10-03T10:00:03Z', { deliveryState: 'sending' }),
    ],
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('useReadTracker', () => {
  it('marks the latest visible message', () => {
    render(<Probe />);
    see('m1', 'm2');
    expect(markRead).toHaveBeenLastCalledWith('c1', expect.objectContaining({ id: 'm2' }));
  });

  it('skips call rows and pending sends', () => {
    render(<Probe />);
    see('call', 'p');
    expect(markRead).not.toHaveBeenCalled();
    see('m1');
    expect(markRead).toHaveBeenLastCalledWith('c1', expect.objectContaining({ id: 'm1' }));
  });

  // Review Focus №4.
  it('no focus: nothing is read until the window gets focus', () => {
    focused = false;
    render(<Probe />);
    see('m2');
    expect(markRead).not.toHaveBeenCalled();
    focused = true;
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(markRead).toHaveBeenLastCalledWith('c1', expect.objectContaining({ id: 'm2' }));
  });

  it('left before focus: a row that scrolled away is not read', () => {
    focused = false;
    render(<Probe />);
    see('m2');
    hide('m2');
    focused = true;
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(markRead).not.toHaveBeenCalled();
  });

  it('hidden tab counts as not attentive', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    render(<Probe />);
    see('m2');
    expect(markRead).not.toHaveBeenCalled();
  });

  // Final review finding 2: сообщение выше окна — нижний край въезжает без
  // пересечения порога, IntersectionObserver молчит; ловим по scroll.
  it('tall row: marked read when its bottom edge scrolls in (no IO callback)', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
    const { container } = render(<Probe />);
    const root = container.firstElementChild as HTMLElement;
    const row = root.querySelector('[data-message-id="m2"]') as HTMLElement;
    let rowBottom = 900;
    row.getBoundingClientRect = () => ({ bottom: rowBottom }) as DOMRect;
    root.getBoundingClientRect = () => ({ bottom: 500 }) as DOMRect;
    act(() => {
      ioCallback!([{ ...entry('m2', true), intersectionRatio: 0.1, boundingClientRect: { bottom: 900 } as DOMRectReadOnly }]);
    });
    expect(markRead).not.toHaveBeenCalled();
    rowBottom = 480;
    act(() => { root.dispatchEvent(new Event('scroll')); });
    expect(markRead).toHaveBeenLastCalledWith('c1', expect.objectContaining({ id: 'm2' }));
  });

  it('tall row: scroll without attention does not read, listener removed on unmount', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
    focused = false;
    const { container, unmount } = render(<Probe />);
    const root = container.firstElementChild as HTMLElement;
    const row = root.querySelector('[data-message-id="m2"]') as HTMLElement;
    row.getBoundingClientRect = () => ({ bottom: 480 }) as DOMRect;
    root.getBoundingClientRect = () => ({ bottom: 500 }) as DOMRect;
    act(() => {
      ioCallback!([{ ...entry('m2', true), intersectionRatio: 0.1, boundingClientRect: { bottom: 900 } as DOMRectReadOnly }]);
    });
    act(() => { root.dispatchEvent(new Event('scroll')); });
    expect(markRead).not.toHaveBeenCalled();
    unmount();
    focused = true;
    act(() => { root.dispatchEvent(new Event('scroll')); });
    expect(markRead).not.toHaveBeenCalled();
  });

  it('disabled: does not observe at all', () => {
    render(<Probe enabled={false} />);
    expect(ioCallback).toBeNull();
  });
});
