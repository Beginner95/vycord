// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageAttachments } from '@/components/MessageAttachments';
import type { Attachment } from '@/types';

function att(over: Partial<Attachment>): Attachment {
  return {
    id: 'a1', channel_id: 'c1', user_id: 'u1', kind: 'file',
    file_name: 'doc.pdf', content_type: 'application/pdf', size_bytes: 1024,
    url: '/api/v1/attachments/a1/content?exp=1&sig=x', created_at: '2026-08-27T10:00:00Z',
    ...over,
  };
}

describe('MessageAttachments', () => {
  it('картинку показывает миниатюрой с зарезервированными размерами', () => {
    render(<MessageAttachments attachments={[att({
      kind: 'image', file_name: 'pic.png', width: 1200, height: 600,
      thumb_url: '/api/v1/attachments/a1/thumb?exp=1&sig=x',
    })]} onOpen={vi.fn()} />);

    const img = screen.getByAltText('pic.png') as HTMLImageElement;
    expect(img.getAttribute('src')).toContain('/thumb');
    // Размеры известны заранее — лента не должна дёргаться при догрузке.
    expect(img.getAttribute('width')).toBe('1200');
    expect(img.getAttribute('height')).toBe('600');
  });

  it('по клику на картинку зовёт onOpen с её индексом', async () => {
    const onOpen = vi.fn();
    render(<MessageAttachments
      attachments={[att({ id: 'a1', kind: 'file' }), att({ id: 'a2', kind: 'image', file_name: 'p.png' })]}
      onOpen={onOpen}
    />);

    screen.getByAltText('p.png').click();

    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it('видео рендерит плеером, а не картинкой', () => {
    const { container } = render(<MessageAttachments
      attachments={[att({ kind: 'video', file_name: 'clip.mp4', content_type: 'video/mp4' })]}
      onOpen={vi.fn()}
    />);

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    // preload=metadata даёт первый кадр вместо чёрного прямоугольника.
    expect(video?.getAttribute('preload')).toBe('metadata');
  });

  it('обычный файл показывает карточкой со ссылкой на скачивание', () => {
    render(<MessageAttachments attachments={[att({ file_name: 'Отчёт.pdf' })]} onOpen={vi.fn()} />);

    const link = screen.getByRole('link', { name: /Отчёт\.pdf/ }) as HTMLAnchorElement;
    // download=1 обязателен: API и фронт на разных доменах, атрибут <a download>
    // для кросс-доменной ссылки браузер игнорирует, и имя файла терялось бы.
    expect(link.href).toContain('download=1');
  });

  it('не рендерит ничего при пустом списке', () => {
    const { container } = render(<MessageAttachments attachments={[]} onOpen={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
