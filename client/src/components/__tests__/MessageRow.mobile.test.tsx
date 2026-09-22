// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { MessageRow } from '@/components/MessageRow';
import type { ChatMessage } from '@/stores/messageStore';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

const msg: ChatMessage = { id: 'm1', channel_id: 'c1', user_id: 'u1', kind: 'user', content: 'text', created_at: 't', updated_at: 't' };
const base = () => ({
  msg, isOwn: true, isContinuation: false, displayName: 'anna', isEditing: false, highlighted: false, entered: false,
  members: [], canMentionEveryone: false,
  onStartEdit: vi.fn(), onCancelEdit: vi.fn(), onSaveEdit: vi.fn(async () => {}), onDelete: vi.fn(), onQuote: vi.fn(),
});
const row = (c: HTMLElement) => c.querySelector('.msg-row') as HTMLElement;
const touchDown = (el: HTMLElement) => fireEvent.pointerDown(el, { pointerType: 'touch', button: 0, clientX: 5, clientY: 5 });

describe('MessageRow long-press seam', () => {
  it('fires onLongPress after the hold and marks the row pressable', () => {
    const onLongPress = vi.fn();
    const { container } = render(<MessageRow {...base()} onLongPress={onLongPress} />);
    expect(row(container).classList.contains('is-pressable')).toBe(true);
    touchDown(row(container));
    act(() => { vi.advanceTimersByTime(460); });
    expect(onLongPress).toHaveBeenCalledOnce();
  });

  it('ignores a mouse hold', () => {
    const onLongPress = vi.fn();
    const { container } = render(<MessageRow {...base()} onLongPress={onLongPress} />);
    fireEvent.pointerDown(row(container), { pointerType: 'mouse', button: 0 });
    act(() => { vi.advanceTimersByTime(600); });
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('is inert without the prop: no class, no handlers', () => {
    const { container } = render(<MessageRow {...base()} />);
    expect(row(container).classList.contains('is-pressable')).toBe(false);
  });

  it('is inert while the row is being edited', () => {
    const onLongPress = vi.fn();
    const { container } = render(<MessageRow {...base()} isEditing onLongPress={onLongPress} />);
    touchDown(row(container));
    act(() => { vi.advanceTimersByTime(600); });
    expect(onLongPress).not.toHaveBeenCalled();
  });
});

describe('MessageRow editActions', () => {
  it('shows Cancel and Save, and blur does NOT cancel', () => {
    const p = base();
    const { container } = render(<MessageRow {...p} isEditing editActions />);
    const ta = container.querySelector('.msg-edit-input') as HTMLTextAreaElement;
    fireEvent.blur(ta);
    expect(p.onCancelEdit).not.toHaveBeenCalled();
    expect(container.querySelectorAll('.msg-edit-actions button')).toHaveLength(2);
  });

  it('Save sends the trimmed wire text; Cancel cancels', () => {
    const p = base();
    const { container } = render(<MessageRow {...p} isEditing editActions />);
    const ta = container.querySelector('.msg-edit-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '  new text  ' } });
    const [cancel, save] = [...container.querySelectorAll('.msg-edit-actions button')];
    fireEvent.click(save);
    expect(p.onSaveEdit).toHaveBeenCalledWith('new text');
    fireEvent.click(cancel);
    expect(p.onCancelEdit).toHaveBeenCalledOnce();
  });

  it('without editActions the editor is exactly as before: blur cancels, no buttons', () => {
    const p = base();
    const { container } = render(<MessageRow {...p} isEditing />);
    fireEvent.blur(container.querySelector('.msg-edit-input')!);
    expect(p.onCancelEdit).toHaveBeenCalledOnce();
    expect(container.querySelector('.msg-edit-actions')).toBeNull();
  });
});
