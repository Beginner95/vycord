// @vitest-environment jsdom
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MessageRow } from '../MessageRow';
import { useLocaleStore } from '@/stores/localeStore';
import { ru } from '@/i18n/locales/ru';
import type { MessageRowReactions } from '../MessageReactions';
import type { ChatMessage } from '@/stores/messageStore';

beforeEach(() => useLocaleStore.setState({ locale: 'ru' }));
afterEach(cleanup);

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', channel_id: 'c1', user_id: 'u2', kind: 'user', content: 'привет', created_at: '2026-10-03T10:00:00Z', updated_at: '2026-10-03T10:00:00Z', ...over,
});
const binding = (over: Partial<MessageRowReactions> = {}): MessageRowReactions => ({
  canReact: true, showReactors: true, inlinePicker: true, onToggle: vi.fn(), ...over,
});
// Держит единственное состояние пикера так же, как ChatArea.
function Harness({ msgs, b, editingId }: { msgs: ChatMessage[]; b: MessageRowReactions; editingId?: string }) {
  const [openPicker, setOpenPicker] = useState<{ messageId: string; placement: 'above' | 'below' } | null>(null);
  const binding: MessageRowReactions = {
    ...b, openPicker,
    onTogglePicker: (messageId, placement) => setOpenPicker(placement ? { messageId, placement } : null),
  };
  return (
    <>
      {msgs.map((m) => (
        <MessageRow key={m.id} msg={m} isOwn={false} isContinuation={false} displayName="боря" isEditing={m.id === editingId}
          highlighted={false} entered={false} members={[]} currentUserId="me" canMentionEveryone={false}
          onStartEdit={vi.fn()} onCancelEdit={vi.fn()} onSaveEdit={vi.fn()} onDelete={vi.fn()} onQuote={vi.fn()}
          reactions={binding} />
      ))}
    </>
  );
}
const row = (m: ChatMessage, reactions?: MessageRowReactions) => reactions
  ? render(<Harness msgs={[m]} b={reactions} />)
  : render(
    <MessageRow msg={m} isOwn={false} isContinuation={false} displayName="боря" isEditing={false}
      highlighted={false} entered={false} members={[]} currentUserId="me" canMentionEveryone={false}
      onStartEdit={vi.fn()} onCancelEdit={vi.fn()} onSaveEdit={vi.fn()} onDelete={vi.fn()} onQuote={vi.fn()} />,
  );
const addBtn = () => Array.from(document.querySelectorAll('.msg-actions button'))
  .find((b) => b.getAttribute('aria-label') === ru.chat.addReaction) ?? null;

describe('MessageRow reactions', () => {
  it('shows the add-reaction action and opens the picker', () => {
    row(msg(), binding());
    expect(addBtn()).not.toBeNull();
    fireEvent.click(addBtn()!);
    expect(document.querySelector('.expression-picker.reaction-picker')).not.toBeNull();
  });

  it('picking an emoji toggles it and closes the picker', () => {
    const b = binding();
    row(msg(), b);
    fireEvent.click(addBtn()!);
    fireEvent.click(Array.from(document.querySelectorAll('.expression-picker button')).find((el) => el.textContent === '👍')!);
    expect(b.onToggle).toHaveBeenCalledWith('m1', '👍', undefined);
    expect(document.querySelector('.reaction-picker')).toBeNull();
  });

  it('opening the picker on another row closes the first one (single picker)', () => {
    render(<Harness msgs={[msg({ id: 'm1' }), msg({ id: 'm2' })]} b={binding()} />);
    const btns = () => Array.from(document.querySelectorAll('.msg-actions button'))
      .filter((b) => b.getAttribute('aria-label') === ru.chat.addReaction);
    expect(btns()).toHaveLength(2);
    fireEvent.mouseDown(btns()[0]); fireEvent.click(btns()[0]);
    fireEvent.mouseDown(btns()[1]); fireEvent.click(btns()[1]);
    const pickers = document.querySelectorAll('.reaction-picker');
    expect(pickers).toHaveLength(1);
    expect(pickers[0].closest('[data-message-id]')?.getAttribute('data-message-id')).toBe('m2');
  });

  it('clicking the toggle of the open row closes its picker', () => {
    row(msg(), binding());
    fireEvent.click(addBtn()!);
    expect(document.querySelector('.reaction-picker')).not.toBeNull();
    fireEvent.click(addBtn()!);
    expect(document.querySelector('.reaction-picker')).toBeNull();
  });

  it('no add action without permission, while sending, or without binding', () => {
    row(msg(), binding({ canReact: false }));
    expect(addBtn()).toBeNull();
    cleanup();
    row(msg({ deliveryState: 'sending' }), binding());
    expect(addBtn()).toBeNull();
    cleanup();
    row(msg());
    expect(addBtn()).toBeNull();
  });

  it('no inline picker on touch layouts', () => {
    row(msg(), binding({ inlinePicker: false }));
    expect(addBtn()).toBeNull();
  });

  it('renders pills under the body', () => {
    row(msg({ reactions: [{ key: '🔥', emoji: '🔥', count: 3, user_ids: ['a'] }] }), binding());
    expect(document.querySelector('.msg-content .msg-reactions .msg-reaction')?.textContent).toContain('3');
  });
});
