// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ExpressionPicker } from '@/components/ExpressionPicker';
import { useExpressionRecentsStore } from '@/stores/expressionRecentsStore';
import type { Sticker } from '@/types';

// Без явного cleanup DOM-узлы от предыдущих it() остаются в document (globals
// не включены в vite.config.ts, поэтому автоматический cleanup из
// @testing-library/react не срабатывает) — getAllByText тогда возвращает
// элементы сразу нескольких рендеров. Тот же приём уже используется в
// OtpCodeInput.test.tsx и MediaLightbox.test.tsx.
afterEach(cleanup);

beforeEach(() => {
  useExpressionRecentsStore.setState({ v: 1, emoji: {}, stickers: {}, lastTab: 'emoji' });
  // jsdom не реализует ни то, ни другое — без заглушек компонент падает на mount.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});

describe('ExpressionPicker', () => {
  it('renders no tab strip when only one tab is offered', () => {
    render(<ExpressionPicker tabs={['emoji']} onClose={vi.fn()} onSelectEmoji={vi.fn()} />);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('renders a tab strip when several tabs are offered, with GIF disabled', () => {
    render(
      <ExpressionPicker tabs={['emoji', 'stickers', 'gif']} onClose={vi.fn()} onSelectEmoji={vi.fn()} />,
    );
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /GIF/ })).toHaveProperty('disabled', true);
  });

  it('selecting an emoji records it and reports it upward', () => {
    const onSelectEmoji = vi.fn();
    render(<ExpressionPicker tabs={['emoji']} onClose={vi.fn()} onSelectEmoji={onSelectEmoji} />);
    fireEvent.click(screen.getAllByText('😀')[0]);
    expect(onSelectEmoji).toHaveBeenCalledWith('😀');
    expect(useExpressionRecentsStore.getState().emoji['😀'].count).toBe(1);
  });

  it('shows the frequently-used section only when there is history', () => {
    const { unmount } = render(
      <ExpressionPicker tabs={['emoji']} onClose={vi.fn()} onSelectEmoji={vi.fn()} />,
    );
    expect(screen.queryByText(/Часто используемые|Frequently used/)).toBeNull();
    unmount();

    useExpressionRecentsStore.setState({ emoji: { '👍': { count: 3, lastUsed: 1 } } });
    render(<ExpressionPicker tabs={['emoji']} onClose={vi.fn()} onSelectEmoji={vi.fn()} />);
    expect(screen.getByText(/Часто используемые|Frequently used/)).toBeTruthy();
  });
});

const sticker = (id: string): Sticker => ({
  id, server_id: 's1', name: id, image_url: `/uploads/${id}.png`,
  created_by: 'u1', created_at: '2026-09-05T00:00:00Z',
});

describe('ExpressionPicker: stickers', () => {
  const openStickers = (items: Sticker[], onSend = vi.fn().mockResolvedValue(true)) => {
    render(
      <ExpressionPicker
        tabs={['emoji', 'stickers', 'gif']}
        initialTab="stickers"
        onClose={vi.fn()}
        onSelectEmoji={vi.fn()}
        stickers={{ serverId: 's1', items, onSend }}
      />,
    );
    return onSend;
  };

  it('records a sticker only after a successful send', async () => {
    const onSend = openStickers([sticker('st-a')]);
    fireEvent.click(screen.getByAltText('st-a'));
    await vi.waitFor(() =>
      expect(useExpressionRecentsStore.getState().stickers.s1['st-a'].count).toBe(1),
    );
    expect(onSend).toHaveBeenCalled();
  });

  it('does not record a sticker when the send fails', async () => {
    const onSend = openStickers([sticker('st-a')], vi.fn().mockResolvedValue(false));
    fireEvent.click(screen.getByAltText('st-a'));
    // Ждём именно вызов onSend, а не «состояние пустое» — последнее верно
    // сразу и waitFor вернулся бы, не дав .then() в choose() ни одного тика.
    await vi.waitFor(() => expect(onSend).toHaveBeenCalled());
    await Promise.resolve();
    expect(useExpressionRecentsStore.getState().stickers.s1).toBeUndefined();
    // Панель осталась открытой: неудачная отправка ничего не закрывает.
    expect(screen.getByAltText('st-a')).toBeTruthy();
  });

  it('drops frequently-used ids that are no longer in the inventory', () => {
    useExpressionRecentsStore.setState({
      stickers: { s1: { 'st-gone': { count: 9, lastUsed: 2 }, 'st-a': { count: 1, lastUsed: 1 } } },
    });
    openStickers([sticker('st-a')]);
    // st-a попадает и в «частые», и в «все»; st-gone не встречается нигде.
    expect(screen.getAllByAltText('st-a')).toHaveLength(2);
    expect(screen.queryByAltText('st-gone')).toBeNull();
  });

  it('shows the empty state for a server with no stickers', () => {
    openStickers([]);
    expect(screen.getByText(/пока нет стикеров|No stickers/)).toBeTruthy();
  });
});
