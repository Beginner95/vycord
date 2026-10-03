// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MessageActionsSheet } from '@/mobile/chat/MessageActionsSheet';
import type { ChatMessage } from '@/stores/messageStore';
import type { MemberWithUser } from '@/types';
import { useExpressionRecentsStore } from '@/stores/expressionRecentsStore';

beforeEach(() => useExpressionRecentsStore.setState(useExpressionRecentsStore.getInitialState()));
afterEach(() => cleanup());

const members: MemberWithUser[] = [];
const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', channel_id: 'c1', user_id: 'u1', kind: 'user', content: 'text',
  created_at: 't', updated_at: 't', ...over,
});
const setup = (m: ChatMessage | null, isOwn = true, extra: Partial<React.ComponentProps<typeof MessageActionsSheet>> = {}) => {
  const h = {
    onClose: vi.fn(), onQuote: vi.fn(), onEdit: vi.fn(),
    onDelete: vi.fn(), onRetry: vi.fn(), onDiscard: vi.fn(),
    canViewReaders: () => false, onReaders: vi.fn(),
  };
  render(
    <MemoryRouter>
      <MessageActionsSheet msg={m} isOwn={isOwn} members={members} {...h} {...extra} />
    </MemoryRouter>,
  );
  return h;
};

describe('MessageActionsSheet', () => {
  it('renders nothing for null msg', () => {
    setup(null);
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(document.querySelector('.action-sheet-item')).toBeNull();
  });

  it('own text: dialog with 4 items', () => {
    setup(msg());
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    expect(document.querySelectorAll('.action-sheet-item')).toHaveLength(4);
  });

  it('delete calls onDelete with the same msg object and onClose', () => {
    const m = msg();
    const h = setup(m);
    fireEvent.click(document.querySelector('.action-sheet-item.is-danger') as HTMLElement);
    expect(h.onDelete).toHaveBeenCalledOnce();
    expect(h.onDelete.mock.calls[0][0]).toBe(m);
    expect(h.onClose).toHaveBeenCalled();
  });

  it('empty menu (sending): closes and mounts no sheet', () => {
    const h = setup(msg({ deliveryState: 'sending' }));
    expect(h.onClose).toHaveBeenCalled();
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(document.querySelector('.action-sheet-item')).toBeNull();
  });

  it('shows six quick reactions and toggles one', () => {
    const onToggle = vi.fn();
    const m = msg({ reactions: [{ key: '👍', emoji: '👍', count: 1, user_ids: ['me'] }] });
    const h = setup(m, false, { currentUserId: 'me', reactions: { canReact: true, onToggle, onMore: vi.fn() } });
    const quick = document.querySelectorAll('.quick-reaction:not(.quick-reaction-more)');
    expect(quick).toHaveLength(6);
    expect(quick[0].classList.contains('is-mine')).toBe(true); // 👍 — дефолт №1 и уже моя
    fireEvent.click(quick[1]);
    expect(onToggle).toHaveBeenCalledWith(m, quick[1].textContent);
    expect(h.onClose).toHaveBeenCalled();
  });

  it('"more" opens the full picker', () => {
    const onMore = vi.fn();
    const m = msg();
    setup(m, false, { reactions: { canReact: true, onToggle: vi.fn(), onMore } });
    fireEvent.click(document.querySelector('.quick-reaction-more')!);
    expect(onMore).toHaveBeenCalledWith(m);
  });

  it('no quick reactions without permission or for a sending message', () => {
    setup(msg(), false, { reactions: { canReact: false, onToggle: vi.fn(), onMore: vi.fn() } });
    expect(document.querySelector('.quick-reactions')).toBeNull();
  });

  it('someone else\'s sticker: sheet stays open when reactions are possible', () => {
    setup(msg({ sticker_id: 's1', content: '' }), false, { reactions: { canReact: true, onToggle: vi.fn(), onMore: vi.fn() } });
    expect(document.querySelector('.quick-reactions')).not.toBeNull();
  });
});
