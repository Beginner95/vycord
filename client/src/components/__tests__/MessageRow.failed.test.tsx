// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MessageRow } from '@/components/MessageRow';
import type { ChatMessage } from '@/stores/messageStore';

afterEach(cleanup);

const failed = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'p1', channel_id: 'c1', user_id: 'u1', kind: 'user', content: 'text', created_at: 't', updated_at: 't',
  deliveryState: 'failed', ...over,
});
const mount = (msg: ChatMessage) => render(
  <MessageRow msg={msg} isOwn isContinuation={false} displayName="anna" isEditing={false} highlighted={false} entered={false}
    members={[]} canMentionEveryone={false} onStartEdit={vi.fn()} onCancelEdit={vi.fn()} onSaveEdit={vi.fn(async () => {})}
    onDelete={vi.fn()} onQuote={vi.fn()} onRetry={vi.fn()} />,
);
const chip = (c: HTMLElement) => c.querySelector('.msg-delivery.is-failed')!.textContent;

describe('MessageRow failed chip', () => {
  it('код с переводом → текст ошибки и «Повторить»', () => {
    const { container } = mount(failed({ deliveryErrorCode: 'voice_invalid' }));
    expect(chip(container)).toBe('Не удалось отправить голосовое сообщение · повторить');
  });

  it('attachment_too_large подставляет размер', () => {
    const { container } = mount(failed({ deliveryErrorCode: 'attachment_too_large' }));
    expect(chip(container)).toMatch(/Максимальный размер — \d+(\.\d)? (MB|KB)/);
  });

  it('без кода или с неизвестным кодом — общий текст', () => {
    expect(chip(mount(failed()).container)).toBe('не отправлено · повторить');
    cleanup();
    expect(chip(mount(failed({ deliveryErrorCode: 'zzz_unknown' })).container)).toBe('не отправлено · повторить');
  });
});
