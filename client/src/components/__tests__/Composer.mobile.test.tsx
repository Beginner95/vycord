// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
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
  it('has a plus button and none of the desktop emoji/attach buttons', () => {
    const { container } = mount();
    expect(container.querySelector('.composer-plus-btn')).not.toBeNull();
    expect(container.querySelector('.composer-attach-btn')).toBeNull();
    expect(container.querySelectorAll('.composer-icon-btn')).toHaveLength(1); // только «＋»
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

  it('plus opens the sheet with four actions; Stickers opens the sheet on the stickers tab', async () => {
    const { container } = mount();
    fireEvent.click(container.querySelector('.composer-plus-btn')!);
    expect(items()).toHaveLength(4);
    fireEvent.click(items()[3]);
    const tabs = await screen.findAllByRole('tab');
    const active = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');
    expect(active).toHaveLength(1);
    expect(active[0].className).toContain('is-active');
    expect(tabs.indexOf(active[0])).toBe(1); // вторая вкладка — «Стикеры»
    expect(document.querySelector('.expression-sheet-body')).not.toBeNull();
  });

  it('the file input lives in the composer and outlives the sheet', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const { container } = mount();
    fireEvent.click(container.querySelector('.composer-plus-btn')!);
    fireEvent.click(items()[1]); // «Файл»
    expect(click).toHaveBeenCalledOnce();
    expect(container.querySelector('.composer-attach-input')).not.toBeNull();
    click.mockRestore();
  });

  it('textOnly (guest): the sheet offers only emoji', () => {
    const { container } = mount({ textOnly: true });
    fireEvent.click(container.querySelector('.composer-plus-btn')!);
    expect(items()).toHaveLength(1);
  });
});
