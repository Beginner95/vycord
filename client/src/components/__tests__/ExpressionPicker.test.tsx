// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ExpressionPicker } from '@/components/ExpressionPicker';
import { useExpressionRecentsStore } from '@/stores/expressionRecentsStore';

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
