// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { useRef } from 'react';
import { useStickToBottom } from '@/hooks/useStickToBottom';

/** Ручной ResizeObserver: jsdom его не даёт, а доставку нужно вызывать самому. */
class FakeRO {
  static all: FakeRO[] = [];
  targets = new Set<Element>();
  disconnected = false;
  constructor(private cb: (entries: { target: Element }[]) => void) { FakeRO.all.push(this); }
  observe(t: Element) { this.targets.add(t); }
  unobserve(t: Element) { this.targets.delete(t); }
  disconnect() { this.disconnected = true; this.targets.clear(); }
  fire(...targets: Element[]) { this.cb(targets.map((target) => ({ target }))); }
}

const SCROLL_HEIGHT = 1000;
const CLIENT_HEIGHT = 400;

interface HarnessProps {
  resetKey?: string;
  ready?: boolean;
  disabled?: boolean;
  followKey?: unknown;
  smooth?: () => void;
  rows?: number;
}

function Harness({ resetKey = 'a', ready = true, disabled, followKey, smooth, rows = 2 }: HarnessProps) {
  const ref = useRef<HTMLDivElement>(null);
  useStickToBottom(ref, { resetKey, ready, disabled, followKey, smoothToBottom: smooth });
  return (
    <div className="box" ref={ref}>
      {Array.from({ length: rows }, (_, i) => <div className="row" key={i} />)}
    </div>
  );
}

let scrollHeight = SCROLL_HEIGHT;
beforeEach(() => {
  scrollHeight = SCROLL_HEIGHT;
  FakeRO.all = [];
  (globalThis as unknown as { ResizeObserver: typeof FakeRO }).ResizeObserver = FakeRO;
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => CLIENT_HEIGHT });
});
afterEach(() => {
  cleanup();
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight;
  delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
});

const box = (c: HTMLElement) => c.querySelector('.box') as HTMLElement;
const userScrollTo = (el: HTMLElement, top: number) => { el.scrollTop = top; fireEvent.scroll(el); };

describe('useStickToBottom', () => {
  it('мгновенно прыгает вниз, как только список готов, и не запускает плавную прокрутку', () => {
    const smooth = vi.fn();
    const { container } = render(<Harness followKey="m1" smooth={smooth} />);
    expect(box(container).scrollTop).toBe(SCROLL_HEIGHT);
    expect(smooth).not.toHaveBeenCalled();
  });

  it('пока список не готов (скелетон) — не прыгает; прыгает, когда готов', () => {
    const { container, rerender } = render(<Harness ready={false} />);
    expect(box(container).scrollTop).toBe(0);
    rerender(<Harness ready />);
    expect(box(container).scrollTop).toBe(SCROLL_HEIGHT);
  });

  it('пока не готов, новое содержимое ничего не докручивает', () => {
    const smooth = vi.fn();
    const { rerender } = render(<Harness ready={false} followKey="m0" smooth={smooth} />);
    rerender(<Harness ready={false} followKey="m1" smooth={smooth} />);
    expect(smooth).not.toHaveBeenCalled();
  });

  it('ресайз содержимого тянет вниз, пока пользователь не ушёл вверх', () => {
    const { container } = render(<Harness />);
    const el = box(container);
    const ro = FakeRO.all[0];
    scrollHeight = 1600; // догрузилась картинка
    act(() => ro.fire(el.querySelector('.row')!));
    expect(el.scrollTop).toBe(1600);
  });

  it('после ручной прокрутки вверх ресайз вниз не тянет; возврат к низу снова прилепляет', () => {
    const { container } = render(<Harness />);
    const el = box(container);
    const ro = FakeRO.all[0];
    userScrollTo(el, 100); // далеко от низа (1000 - 100 - 400 = 500 > 80)
    scrollHeight = 1600;
    act(() => ro.fire(el.querySelector('.row')!));
    expect(el.scrollTop).toBe(100);

    userScrollTo(el, 1600 - CLIENT_HEIGHT - 10); // вернулся к низу в пределах порога
    scrollHeight = 2000;
    act(() => ro.fire(el.querySelector('.row')!));
    expect(el.scrollTop).toBe(2000);
  });

  it('рост scrollTop при плавной прокрутке (далеко от низа) флаг не гасит', () => {
    const { container } = render(<Harness />);
    const el = box(container);
    const ro = FakeRO.all[0];
    userScrollTo(el, 300); // вниз-вниз: было 1000 после прыжка -> 300 это уменьшение
    userScrollTo(el, 100);
    userScrollTo(el, 200); // промежуточный кадр smooth вниз: рост, но ещё далеко
    scrollHeight = 1500;
    act(() => ro.fire(el.querySelector('.row')!));
    expect(el.scrollTop).toBe(200); // пользователь всё ещё «ушёл»
  });

  it('смена resetKey (другой канал) заново прилепляет к низу и прыгает', () => {
    const { container, rerender } = render(<Harness resetKey="a" />);
    const el = box(container);
    userScrollTo(el, 0);
    rerender(<Harness resetKey="b" ready={false} />);
    rerender(<Harness resetKey="b" ready />);
    expect(el.scrollTop).toBe(SCROLL_HEIGHT);
    const ro = FakeRO.all[FakeRO.all.length - 1];
    scrollHeight = 1300;
    act(() => ro.fire(el));
    expect(el.scrollTop).toBe(1300);
  });

  it('новое содержимое после входа — плавная прокрутка; ресайз при disabled не тянет', () => {
    const smooth = vi.fn();
    const { container, rerender } = render(<Harness followKey="m1" smooth={smooth} />);
    rerender(<Harness followKey="m2" smooth={smooth} />);
    expect(smooth).toHaveBeenCalledTimes(1);

    const el = box(container);
    rerender(<Harness followKey="m2" smooth={smooth} disabled />);
    userScrollTo(el, 50);
    scrollHeight = 1800;
    act(() => FakeRO.all[FakeRO.all.length - 1].fire(el));
    expect(el.scrollTop).toBe(50);
    // и в disabled новое содержимое не докручивается
    rerender(<Harness followKey="m3" smooth={smooth} disabled />);
    expect(smooth).toHaveBeenCalledTimes(1);
  });

  it('добавленная позже строка: первая доставка RO — не рост (плавность сохраняется), следующая — рост', async () => {
    const { container, rerender } = render(<Harness rows={2} />);
    const el = box(container);
    const ro = FakeRO.all[0];
    rerender(<Harness rows={3} />);
    await act(async () => {}); // MutationObserver — микрозадача
    const added = el.querySelectorAll('.row')[2];
    expect(ro.targets.has(added)).toBe(true);

    scrollHeight = 1200;
    el.scrollTop = 900;
    act(() => ro.fire(added));
    expect(el.scrollTop).toBe(900); // появление строки не прыгает
    act(() => ro.fire(added));
    expect(el.scrollTop).toBe(1200); // картинка догрузилась — прыжок
  });

  it('без ResizeObserver не падает; при размонтировании наблюдатель отключается', () => {
    const { unmount } = render(<Harness />);
    const ro = FakeRO.all[0];
    unmount();
    expect(ro.disconnected).toBe(true);

    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    const { container } = render(<Harness />);
    expect(box(container).scrollTop).toBe(SCROLL_HEIGHT);
  });

  it('после возврата из disabled (скрытый экран) докручивает до низа, если был прилип', () => {
    const { container, rerender } = render(<Harness />);
    const el = box(container);
    rerender(<Harness disabled />);
    scrollHeight = 1800; // пока экран был скрыт, пришли сообщения
    rerender(<Harness disabled={false} />);
    expect(el.scrollTop).toBe(1800);
  });

  it('после возврата из disabled не трогает прокрутку, если пользователь ушёл вверх', () => {
    const { container, rerender } = render(<Harness />);
    const el = box(container);
    userScrollTo(el, 100);
    rerender(<Harness disabled />);
    scrollHeight = 1800;
    rerender(<Harness disabled={false} />);
    expect(el.scrollTop).toBe(100);
  });
});
