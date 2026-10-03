// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMessageActions, type MessageActionsInput } from '../useMessageActions';
import { useLocaleStore } from '@/stores/localeStore';

beforeEach(() => { useLocaleStore.setState({ locale: 'ru' }); });

const input = (over: Partial<MessageActionsInput> = {}): MessageActionsInput => ({
  msg: { id: 'm', channel_id: 'c', user_id: 'me', content: 'привет', kind: 'user', created_at: 't', updated_at: 't' },
  canModify: true, members: [],
  onQuote: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onRetry: vi.fn(), onDiscard: vi.fn(),
  ...over,
});

describe('useMessageActions — readers', () => {
  it('adds "Кто прочитал" only when onReaders is given', () => {
    const without = renderHook(() => useMessageActions(input())).result.current;
    expect(without.map((i) => i.label)).not.toContain('Кто прочитал');
    const onReaders = vi.fn();
    const withIt = renderHook(() => useMessageActions(input({ onReaders }))).result.current;
    const item = withIt.find((i) => i.label === 'Кто прочитал');
    expect(item).toBeDefined();
    item!.onClick();
    expect(onReaders).toHaveBeenCalled();
  });
});
