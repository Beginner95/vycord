import { describe, it, expect, beforeEach } from 'vitest';
import { useMessageStore, type ChatMessage } from '../messageStore';

const m = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id, channel_id: 'c', user_id: 'u', content: 'hi',
  created_at: '2026-08-25T12:00:00Z', updated_at: '2026-08-25T12:00:00Z', ...over,
});

beforeEach(() => {
  useMessageStore.setState({ messages: [], loading: false });
});

describe('messageStore delivery/loading', () => {
  it('replaceMessage swaps in place preserving order', () => {
    const s = useMessageStore.getState();
    s.setMessages([m('a'), m('pending-1', { deliveryState: 'sending' }), m('b')]);
    s.replaceMessage('pending-1', m('server-id'));
    expect(useMessageStore.getState().messages.map((x) => x.id)).toEqual(['a', 'server-id', 'b']);
    expect(useMessageStore.getState().messages[1].deliveryState).toBeUndefined();
  });
  it('replaceMessage with unknown id is a no-op', () => {
    const s = useMessageStore.getState();
    s.setMessages([m('a')]);
    s.replaceMessage('nope', m('x'));
    expect(useMessageStore.getState().messages.map((x) => x.id)).toEqual(['a']);
  });
  it('updateMessage can set and clear deliveryState', () => {
    const s = useMessageStore.getState();
    s.setMessages([m('p', { deliveryState: 'sending' })]);
    s.updateMessage('p', { deliveryState: 'failed' });
    expect(useMessageStore.getState().messages[0].deliveryState).toBe('failed');
    // Половина, которой у теста не было: имя обещало «and clear», а очистку он
    // никогда не проверял. Она не декоративна — это путь «отправка удалась»:
    // MessageRow.css гасит .msg-row.is-sending / .is-failed по этому же полю,
    // так что не сброшенный deliveryState оставил бы доставленное сообщение
    // приглушённым навсегда.
    s.updateMessage('p', { deliveryState: undefined });
    expect(useMessageStore.getState().messages[0].deliveryState).toBeUndefined();
    // Остальное сообщение переживает очистку — патч не подменяет объект целиком.
    expect(useMessageStore.getState().messages[0].id).toBe('p');
  });
  it('setLoading toggles', () => {
    useMessageStore.getState().setLoading(true);
    expect(useMessageStore.getState().loading).toBe(true);
  });
});
