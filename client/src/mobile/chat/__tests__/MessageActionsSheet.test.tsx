// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MessageActionsSheet } from '@/mobile/chat/MessageActionsSheet';
import type { ChatMessage } from '@/stores/messageStore';
import type { MemberWithUser } from '@/types';

afterEach(() => cleanup());

const members: MemberWithUser[] = [];
const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', channel_id: 'c1', user_id: 'u1', kind: 'user', content: 'text',
  created_at: 't', updated_at: 't', ...over,
});
const setup = (m: ChatMessage | null, isOwn = true) => {
  const h = {
    onClose: vi.fn(), onQuote: vi.fn(), onEdit: vi.fn(),
    onDelete: vi.fn(), onRetry: vi.fn(), onDiscard: vi.fn(),
  };
  render(
    <MemoryRouter>
      <MessageActionsSheet msg={m} isOwn={isOwn} members={members} {...h} />
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
});
