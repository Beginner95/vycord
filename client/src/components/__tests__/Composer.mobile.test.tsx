// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Composer } from '@/components/Composer';

vi.mock('@/services/api', () => ({ apiService: {} }));

afterEach(cleanup);

const channel = { id: 'c1', name: 'general', server_id: 's1' };
const mount = (over: Record<string, unknown> = {}) => {
  const onSend = vi.fn();
  const utils = render(
    <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'servers' }], b: 0 } }]}>
      <Composer channel={channel} members={[]} canMentionEveryone={false} onSend={onSend}
        serverStickers={[]} onSendSticker={vi.fn(async () => true)} variant="mobile" {...over} />
    </MemoryRouter>,
  );
  return { ...utils, onSend, field: utils.container.querySelector('.composer-input') as HTMLTextAreaElement };
};
const send = (c: HTMLElement) => c.querySelector('.composer-send');
const items = () => document.querySelectorAll('.sheet .action-sheet-item');

describe('Composer mobile variant', () => {
  it('lays out Aa, emoji, paperclip, send in DOM order; no plus button', () => {
    const { container, field } = mount();
    fireEvent.change(field, { target: { value: 'hi' } });
    const row = [...container.querySelectorAll('.composer-field > *')];
    const idx = (el: Element | null) => row.indexOf(el as Element);
    const aa = container.querySelector('.composer-aa');
    const emoji = container.querySelector('.composer-icon-btn:not(.composer-clip-btn)');
    const clip = container.querySelector('.composer-clip-btn');
    const sendBtn = send(container);
    expect(field.previousElementSibling).toBeNull(); // слева от поля ничего нет
    expect(idx(field)).toBe(0);
    expect(idx(aa)).toBe(1);
    expect(idx(emoji)).toBe(2);
    expect(idx(clip)).toBe(3);
    expect(idx(sendBtn)).toBe(4);
    expect(container.querySelector('.composer-attach-btn')).toBeNull();
    expect(container.querySelectorAll('.composer-icon-btn')).toHaveLength(2); // эмодзи + скрепка
  });

  it('shows Send only when there is something to send', () => {
    const { container, field } = mount();
    expect(send(container)).toBeNull();
    fireEvent.change(field, { target: { value: 'hi' } });
    expect(send(container)).not.toBeNull();
    fireEvent.change(field, { target: { value: '   ' } });
    expect(send(container)).toBeNull();
  });

  it('Enter sends by default and inserts a newline when enterSends is false', () => {
    const a = mount();
    fireEvent.change(a.field, { target: { value: 'hi' } });
    fireEvent.keyDown(a.field, { key: 'Enter' });
    expect(a.onSend).toHaveBeenCalledWith('hi', undefined);
    cleanup();
    const b = mount({ enterSends: false });
    fireEvent.change(b.field, { target: { value: 'hi' } });
    fireEvent.keyDown(b.field, { key: 'Enter' });
    expect(b.onSend).not.toHaveBeenCalled();
  });

  it('Smile opens the expression sheet on the emoji tab', async () => {
    const { container } = mount();
    fireEvent.click(container.querySelector('.composer-icon-btn:not(.composer-clip-btn)')!);
    const tabs = await screen.findAllByRole('tab');
    const active = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');
    expect(active).toHaveLength(1);
    expect(tabs.indexOf(active[0])).toBe(0);
    expect(tabs).toHaveLength(2); // эмодзи + стикеры
    expect(document.querySelector('.expression-sheet-body')).not.toBeNull();
    expect(document.querySelector('.sheet .action-sheet-item')).toBeNull();
  });

  it('paperclip opens the sheet with exactly two actions (media, file)', () => {
    const { container } = mount();
    fireEvent.click(container.querySelector('.composer-clip-btn')!);
    expect(items()).toHaveLength(2);
    expect(items()[0].textContent).toContain('Фото и видео');
    expect(items()[1].textContent).toContain('Файл');
    expect(document.querySelector('.expression-sheet-body')).toBeNull();
  });

  it('media action opens the picker for images/videos, file action for anything', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const { container } = mount();
    const input = () => container.querySelector('.composer-attach-input') as HTMLInputElement;
    fireEvent.click(container.querySelector('.composer-clip-btn')!);
    fireEvent.click(items()[0]);
    expect(input().accept).toBe('image/*,video/*');
    fireEvent.click(container.querySelector('.composer-clip-btn')!);
    fireEvent.click(items()[1]);
    expect(input().accept).toBe('');
    expect(click).toHaveBeenCalledTimes(2);
    click.mockRestore();
  });

  it('the file input lives in the composer and outlives the sheet', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const { container } = mount();
    fireEvent.click(container.querySelector('.composer-clip-btn')!);
    fireEvent.click(items()[1]); // «Файл»
    expect(click).toHaveBeenCalledOnce();
    expect(container.querySelector('.composer-attach-input')).not.toBeNull();
    click.mockRestore();
  });

  it('textOnly (guest): no paperclip, emoji stays and shows only the emoji tab', async () => {
    const { container } = mount({ textOnly: true });
    expect(container.querySelector('.composer-clip-btn')).toBeNull();
    expect(container.querySelectorAll('.composer-icon-btn')).toHaveLength(1);
    fireEvent.click(container.querySelector('.composer-icon-btn:not(.composer-clip-btn)')!);
    await waitFor(() => expect(document.querySelector('.expression-sheet-body')).not.toBeNull());
    expect(screen.queryAllByRole('tab').length).toBeLessThanOrEqual(1); // вкладки стикеров нет
  });
});
