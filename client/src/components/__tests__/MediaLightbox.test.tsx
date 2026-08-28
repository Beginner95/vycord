// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MediaLightbox, pickLightboxMedia } from '@/components/MediaLightbox';
import type { Attachment } from '@/types';

afterEach(cleanup);

function img(id: string, name: string): Attachment {
  return {
    id, channel_id: 'c', user_id: 'u', kind: 'image', file_name: name,
    content_type: 'image/png', size_bytes: 10, url: `/api/v1/attachments/${id}/content?exp=1&sig=x`,
    created_at: '2026-08-27T10:00:00Z',
  };
}

function att(id: string, kind: Attachment['kind'], name: string): Attachment {
  return { ...img(id, name), kind };
}

describe('pickLightboxMedia', () => {
  it('оставляет только картинки и видео, пересчитывая индекс', () => {
    // Сквозной индекс от ленты: [png, mp3, mp4, pdf], клик по mp4 — это 2.
    const list = [att('a', 'image', 'p.png'), att('b', 'audio', 's.mp3'),
      att('c', 'video', 'v.mp4'), att('d', 'file', 'd.pdf')];

    const got = pickLightboxMedia(list, 2);

    expect(got?.attachments.map((a) => a.id)).toEqual(['a', 'c']);
    expect(got?.index).toBe(1);
  });

  it('вторая картинка открывается именно второй, а не соседним аудио', () => {
    const list = [att('a', 'image', 'one.png'), att('b', 'audio', 's.mp3'), att('c', 'image', 'two.png')];

    const got = pickLightboxMedia(list, 2);

    expect(got?.attachments[got.index].file_name).toBe('two.png');
  });

  it('по не-медиа лайтбокс не открывается', () => {
    // Иначе стрелка вправо выдавала бы <img src="…аудио…"> — битую картинку.
    const list = [att('a', 'image', 'p.png'), att('b', 'audio', 's.mp3')];

    expect(pickLightboxMedia(list, 1)).toBeNull();
    expect(pickLightboxMedia(list, 5)).toBeNull();
  });
});

describe('MediaLightbox', () => {
  it('показывает вложение под текущим индексом', () => {
    render(<MediaLightbox attachments={[img('a', 'one.png'), img('b', 'two.png')]} index={1}
      onIndexChange={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByAltText('two.png')).toBeTruthy();
  });

  it('в фуллскрине показывает оригинал, а не миниатюру', () => {
    const a = { ...img('a', 'one.png'), thumb_url: '/api/v1/attachments/a/thumb?exp=1&sig=x' };
    render(<MediaLightbox attachments={[a]} index={0} onIndexChange={vi.fn()} onClose={vi.fn()} />);

    const el = screen.getByAltText('one.png') as HTMLImageElement;
    expect(el.getAttribute('src')).toContain('/content');
    expect(el.getAttribute('src')).not.toContain('/thumb');
  });

  it('Escape закрывает', () => {
    const onClose = vi.fn();
    render(<MediaLightbox attachments={[img('a', 'one.png')]} index={0} onIndexChange={vi.fn()} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('стрелки листают вложения', () => {
    const onIndexChange = vi.fn();
    render(<MediaLightbox attachments={[img('a', 'one.png'), img('b', 'two.png')]} index={0}
      onIndexChange={onIndexChange} onClose={vi.fn()} />);

    fireEvent.keyDown(document, { key: 'ArrowRight' });

    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it('не листает за пределы списка', () => {
    const onIndexChange = vi.fn();
    render(<MediaLightbox attachments={[img('a', 'one.png')]} index={0}
      onIndexChange={onIndexChange} onClose={vi.fn()} />);

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.keyDown(document, { key: 'ArrowLeft' });

    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it('даёт скачать текущее вложение с правильным именем', () => {
    render(<MediaLightbox attachments={[img('a', 'Отчёт.png')]} index={0}
      onIndexChange={vi.fn()} onClose={vi.fn()} />);

    const link = document.querySelector('.lightbox-download') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.href).toContain('download=1');
  });
});
