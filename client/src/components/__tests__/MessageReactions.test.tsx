// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MessageReactions, type MessageRowReactions } from '../MessageReactions';
import { useLocaleStore } from '@/stores/localeStore';
import type { MemberWithUser, Reaction } from '@/types';

beforeEach(() => useLocaleStore.setState({ locale: 'ru' }));
afterEach(cleanup);

const members = [
  { user_id: 'a', username: 'аня' }, { user_id: 'b', username: 'боря' },
  { user_id: 'c', username: 'вова' }, { user_id: 'd', username: 'галя' },
] as unknown as MemberWithUser[];

const binding = (over: Partial<MessageRowReactions> = {}): MessageRowReactions => ({
  canReact: true, showReactors: true, inlinePicker: true, onToggle: vi.fn(), ...over,
});

const thumbs: Reaction = { key: '👍', emoji: '👍', count: 5, user_ids: ['a', 'b', 'c', 'd', 'me'] };

describe('MessageReactions', () => {
  it('renders pills with counts and marks mine', () => {
    render(<MessageReactions messageId="m1" reactions={[thumbs, { key: '😂', emoji: '😂', count: 1, user_ids: ['a'] }]}
      currentUserId="me" members={members} binding={binding()} />);
    const pills = document.querySelectorAll('.msg-reaction');
    expect(pills).toHaveLength(2);
    expect(pills[0].textContent).toContain('5');
    expect(pills[0].classList.contains('is-mine')).toBe(true);
    expect(pills[0].getAttribute('aria-pressed')).toBe('true');
    expect(pills[1].classList.contains('is-mine')).toBe(false);
    expect(pills[0].getAttribute('aria-label')).toBe('👍: 5 реакций');
  });

  it('toggles by key on click', () => {
    const b = binding();
    render(<MessageReactions messageId="m1" reactions={[thumbs]} currentUserId="me" members={members} binding={b} />);
    fireEvent.click(document.querySelector('.msg-reaction')!);
    expect(b.onToggle).toHaveBeenCalledWith('m1', '👍', undefined);
  });

  it('passes the sticker on a sticker pill and renders it small', () => {
    const sticker = { id: 's1', server_id: 'srv', name: 'cat', image_url: '/u/cat.png', created_by: 'a', created_at: '' };
    const b = binding({ knownStickerIds: new Set(['s1']) });
    render(<MessageReactions messageId="m1" reactions={[{ key: 'sticker:s1', sticker, count: 1, user_ids: ['a'] }]}
      currentUserId="me" members={members} binding={b} />);
    const img = document.querySelector('img.msg-reaction-sticker') as HTMLImageElement;
    expect(img.alt).toBe('cat');
    fireEvent.click(document.querySelector('.msg-reaction')!);
    expect(b.onToggle).toHaveBeenCalledWith('m1', 'sticker:s1', sticker);
  });

  it('hides a sticker reaction whose sticker is gone', () => {
    const sticker = { id: 's9', server_id: 'srv', name: 'old', image_url: '/u/old.png', created_by: 'a', created_at: '' };
    const { container } = render(<MessageReactions messageId="m1"
      reactions={[{ key: 'sticker:s9', sticker, count: 1, user_ids: ['a'] }]}
      currentUserId="me" members={members} binding={binding({ knownStickerIds: new Set() })} />);
    expect(container.querySelector('.msg-reaction')).toBeNull();
  });

  it('shows "names and N more" on hover', () => {
    render(<MessageReactions messageId="m1" reactions={[thumbs]} currentUserId="me" members={members} binding={binding()} />);
    fireEvent.mouseEnter(document.querySelector('.msg-reaction')!);
    expect(document.querySelector('.reaction-tooltip')?.textContent).toContain('аня, боря, вова и ещё 2');
    fireEvent.mouseLeave(document.querySelector('.msg-reaction')!);
    expect(document.querySelector('.reaction-tooltip')).toBeNull();
  });

  it('read-only: no click, no add button, no tooltip for guests', () => {
    const b = binding({ canReact: false, showReactors: false });
    render(<MessageReactions messageId="m1" reactions={[thumbs]} members={members} binding={b} onAdd={vi.fn()} />);
    const pill = document.querySelector('.msg-reaction')!;
    expect(pill.tagName).toBe('SPAN');
    fireEvent.click(pill);
    fireEvent.mouseEnter(pill);
    expect(b.onToggle).not.toHaveBeenCalled();
    expect(document.querySelector('.reaction-tooltip')).toBeNull();
    expect(document.querySelector('.msg-reaction-add')).toBeNull();
  });

  it('add button calls onAdd', () => {
    const onAdd = vi.fn();
    render(<MessageReactions messageId="m1" reactions={[thumbs]} currentUserId="me" members={members} binding={binding()} onAdd={onAdd} />);
    fireEvent.click(document.querySelector('.msg-reaction-add')!);
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('renders nothing for an empty list', () => {
    const { container } = render(<MessageReactions messageId="m1" reactions={[]} members={members} binding={binding()} />);
    expect(container.innerHTML).toBe('');
  });

  it('long-press on a pill shows reactors and does not reach the row', () => {
    vi.useFakeTimers();
    const onShowReactors = vi.fn();
    const rowDown = vi.fn();
    render(
      <div onPointerDown={rowDown}>
        <MessageReactions messageId="m1" reactions={[thumbs]} currentUserId="me" members={members}
          binding={binding({ onShowReactors, inlinePicker: false })} />
      </div>,
    );
    fireEvent.pointerDown(document.querySelector('.msg-reaction')!, { pointerType: 'touch', button: 0, clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(500);
    expect(onShowReactors).toHaveBeenCalledWith('m1', thumbs);
    expect(rowDown).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
