// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { ReadReceipt } from '../ReadReceipt';
import { useUnreadStore } from '@/stores/unreadStore';
import { useLocaleStore } from '@/stores/localeStore';
import type { Message } from '@/types';

vi.mock('@/services/api', () => ({ apiService: {} }));

const msg: Message = { id: 'm5', channel_id: 'c1', user_id: 'me', content: 'x', kind: 'user', created_at: '2026-10-03T10:00:05Z', updated_at: '2026-10-03T10:00:05Z' };

beforeEach(() => { useLocaleStore.setState({ locale: 'ru' }); useUnreadStore.getState().reset(); });
afterEach(cleanup);

describe('ReadReceipt', () => {
  it('grey "sent" until someone else reads up to the message', () => {
    render(<ReadReceipt msg={msg} />);
    const el = document.querySelector('.msg-receipt')!;
    expect(el.classList.contains('is-read')).toBe(false);
    expect(el.getAttribute('aria-label')).toBe('Отправлено');
  });

  it('turns read when othersRead reaches it, live', () => {
    render(<ReadReceipt msg={msg} />);
    act(() => { useUnreadStore.getState().applyChannelRead({ channel_id: 'c1', read_at: '2026-10-03T10:00:04Z', message_id: 'm4' }); });
    expect(document.querySelector('.msg-receipt')!.classList.contains('is-read')).toBe(false);
    act(() => { useUnreadStore.getState().applyChannelRead({ channel_id: 'c1', read_at: '2026-10-03T10:00:05Z', message_id: 'm5' }); });
    const el = document.querySelector('.msg-receipt')!;
    expect(el.classList.contains('is-read')).toBe(true);
    expect(el.getAttribute('aria-label')).toBe('Прочитано');
  });

  it('is a button only when it can open the readers list', () => {
    const onOpen = vi.fn();
    const { rerender } = render(<ReadReceipt msg={msg} />);
    expect(document.querySelector('button.msg-receipt')).toBeNull();
    rerender(<ReadReceipt msg={msg} onOpen={onOpen} />);
    fireEvent.click(document.querySelector('button.msg-receipt')!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
