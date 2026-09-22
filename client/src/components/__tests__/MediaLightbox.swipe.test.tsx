// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MediaLightbox } from '../MediaLightbox';
import { stubBrowser } from './chatHarness';
import type { Attachment } from '@/types';

beforeAll(stubBrowser);
afterEach(cleanup);
// Порог жеста считается от размера окна, а не от скорости (timeStamp jsdom нестабилен).
const origSize = { w: window.innerWidth, h: window.innerHeight };
beforeEach(() => {
  window.innerWidth = 400;
  window.innerHeight = 768;
});
afterEach(() => {
  window.innerWidth = origSize.w;
  window.innerHeight = origSize.h;
});

const att = (id: string): Attachment => ({
  id, channel_id: 'c1', user_id: 'u1', kind: 'image', file_name: `${id}.png`, content_type: 'image/png', size_bytes: 10,
  url: `/api/v1/attachments/${id}/content?exp=1&sig=x`, created_at: '2026-09-20T09:00:00Z',
});
const three = [att('a'), att('b'), att('c')];

function setup(index: number) {
  const onIndexChange = vi.fn();
  const onClose = vi.fn();
  render(<MediaLightbox attachments={three} index={index} onIndexChange={onIndexChange} onClose={onClose} />);
  const content = document.querySelector('.lightbox-content') as HTMLElement;
  return { onIndexChange, onClose, content };
}

/** Жест пальцем: down → move → up, координаты относительно точки (200, 300). */
function drag(el: Element, dx: number, dy: number, pointerType = 'touch') {
  const o = { pointerId: 1, pointerType };
  fireEvent.pointerDown(el, { ...o, clientX: 200, clientY: 300 });
  fireEvent.pointerMove(el, { ...o, clientX: 200 + dx, clientY: 300 + dy });
  fireEvent.pointerUp(el, { ...o, clientX: 200 + dx, clientY: 300 + dy });
}

describe('MediaLightbox swipe', () => {
  it('swipe left → next, right → prev', () => {
    const a = setup(1);
    drag(a.content, -150, 0);
    expect(a.onIndexChange).toHaveBeenCalledWith(2);
    cleanup();
    const b = setup(1);
    drag(b.content, 150, 0);
    expect(b.onIndexChange).toHaveBeenCalledWith(0);
  });

  it('swipe down closes', () => {
    const { content, onClose, onIndexChange } = setup(1);
    drag(content, 0, 400);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it('swiping past the last / first item does not change the index', () => {
    const last = setup(2);
    drag(last.content, -150, 0);
    expect(last.onIndexChange).not.toHaveBeenCalled();
    cleanup();
    const first = setup(0);
    drag(first.content, 150, 0);
    expect(first.onIndexChange).not.toHaveBeenCalled();
  });

  it('a gesture that starts on the download link is ignored', () => {
    const { content, onClose, onIndexChange } = setup(1);
    drag(content.querySelector('.lightbox-download')!, -150, 0);
    drag(content.querySelector('.lightbox-download')!, 0, 400);
    expect(onIndexChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a mouse pointer is ignored', () => {
    const { content, onClose, onIndexChange } = setup(1);
    drag(content, -150, 0, 'mouse');
    drag(content, 0, 400, 'mouse');
    expect(onIndexChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('follows the finger while dragging and leaves no style at rest', () => {
    const { content } = setup(1);
    expect(content.hasAttribute('style')).toBe(false);
    const o = { pointerId: 1, pointerType: 'touch' };
    fireEvent.pointerDown(content, { ...o, clientX: 200, clientY: 300 });
    fireEvent.pointerMove(content, { ...o, clientX: 260, clientY: 300 });
    expect(content.style.transform).toBe('translateX(60px)');
    fireEvent.pointerCancel(content, o);
    // React после снятия inline-стилей оставляет пустой style="" — важно, что transform ушёл.
    expect(content.style.transform).toBe('');
  });

  describe('pointer capture (tap-to-play на <video> не должен теряться)', () => {
    // jsdom не определяет setPointerCapture — подставляем шпион на прототип.
    const proto = HTMLElement.prototype as unknown as { setPointerCapture?: (id: number) => void };
    const had = 'setPointerCapture' in proto;
    const orig = proto.setPointerCapture;
    let spy: ReturnType<typeof vi.fn<(id: number) => void>>;
    beforeEach(() => { spy = vi.fn<(id: number) => void>(); proto.setPointerCapture = spy; });
    afterEach(() => { if (had) proto.setPointerCapture = orig; else delete proto.setPointerCapture; });

    const o = { pointerId: 1, pointerType: 'touch' };

    it('a pure tap never captures the pointer', () => {
      const { content } = setup(1);
      fireEvent.pointerDown(content, { ...o, clientX: 200, clientY: 300 });
      fireEvent.pointerUp(content, { ...o, clientX: 200, clientY: 300 });
      expect(spy).not.toHaveBeenCalled();
    });

    it('movement within the slop does not capture', () => {
      const { content } = setup(1);
      fireEvent.pointerDown(content, { ...o, clientX: 200, clientY: 300 });
      fireEvent.pointerMove(content, { ...o, clientX: 205, clientY: 304 });
      expect(spy).not.toHaveBeenCalled();
    });

    it('movement past the slop captures exactly once per gesture', () => {
      const { content } = setup(1);
      fireEvent.pointerDown(content, { ...o, clientX: 200, clientY: 300 });
      fireEvent.pointerMove(content, { ...o, clientX: 230, clientY: 300 });
      fireEvent.pointerMove(content, { ...o, clientX: 260, clientY: 300 });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(1);
      fireEvent.pointerUp(content, { ...o, clientX: 260, clientY: 300 });
      // Следующий жест снова может захватить.
      fireEvent.pointerDown(content, { ...o, clientX: 200, clientY: 300 });
      fireEvent.pointerMove(content, { ...o, clientX: 260, clientY: 300 });
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('a tap on a child still delivers click to that child', () => {
      const { content } = setup(1);
      const media = content.querySelector('.lightbox-media')!;
      const onClick = vi.fn();
      media.addEventListener('click', onClick);
      fireEvent.pointerDown(media, { ...o, clientX: 200, clientY: 300 });
      fireEvent.pointerUp(media, { ...o, clientX: 200, clientY: 300 });
      fireEvent.click(media);
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
