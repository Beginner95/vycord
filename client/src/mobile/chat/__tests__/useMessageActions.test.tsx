// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMessageActions } from '@/mobile/chat/useMessageActions';
import { toDisplayMentions } from '@/utils/mentions';
import type { ChatMessage } from '@/stores/messageStore';
import type { MemberWithUser } from '@/types';

const UID = '11111111-1111-1111-1111-111111111111';
const members = [{ user_id: UID, username: 'boris' } as MemberWithUser];
const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', channel_id: 'c1', user_id: 'u1', kind: 'user', content: 'text',
  created_at: 't', updated_at: 't', ...over,
});
const handlers = () => ({ onQuote: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onRetry: vi.fn(), onDiscard: vi.fn() });
const items = (m: ChatMessage, canModify: boolean, h = handlers()) =>
  renderHook(() => useMessageActions({ msg: m, canModify, members, ...h })).result.current;

const writeText = vi.fn(async () => {});
beforeEach(() => { writeText.mockClear(); Object.assign(navigator, { clipboard: { writeText } }); });

describe('useMessageActions', () => {
  it('own sent text: quote, copy, edit, delete (danger last)', () => {
    const h = handlers();
    const list = items(msg(), true, h);
    expect(list.map((i) => !!i.danger)).toEqual([false, false, false, true]);
    list[0].onClick(); list[2].onClick(); list[3].onClick();
    expect(h.onQuote).toHaveBeenCalledOnce();
    expect(h.onEdit).toHaveBeenCalledOnce();
    expect(h.onDelete).toHaveBeenCalledOnce();
  });

  it("someone else's text: quote and copy only", () => {
    const list = items(msg({ user_id: 'u2' }), false);
    expect(list).toHaveLength(2);
    expect(list.some((i) => i.danger)).toBe(false);
  });

  it('copy puts the DISPLAY form of mentions on the clipboard, not <@uuid>', () => {
    const content = `hi <@${UID}>`;
    items(msg({ content }), true)[1].onClick();
    expect(writeText).toHaveBeenCalledWith(toDisplayMentions(content, members));
    expect(writeText).not.toHaveBeenCalledWith(content);
  });

  it('own sticker: delete only; foreign sticker: nothing', () => {
    const own = items(msg({ sticker_id: 'st', content: '' }), true);
    expect(own).toHaveLength(1);
    expect(own[0].danger).toBe(true);
    expect(items(msg({ sticker_id: 'st', content: '', user_id: 'u2' }), false)).toHaveLength(0);
  });

  it('attachment-only own message: edit and delete, no quote/copy', () => {
    expect(items(msg({ content: '' }), true)).toHaveLength(2);
  });

  it('failed: retry then discard (danger); sending: nothing', () => {
    const h = handlers();
    const failed = items(msg({ deliveryState: 'failed' }), true, h);
    expect(failed.map((i) => !!i.danger)).toEqual([false, true]);
    failed[0].onClick(); failed[1].onClick();
    expect(h.onRetry).toHaveBeenCalledOnce();
    expect(h.onDiscard).toHaveBeenCalledOnce();
    expect(items(msg({ deliveryState: 'sending' }), true)).toEqual([]);
  });
});
