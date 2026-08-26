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
  });
  it('setLoading toggles', () => {
    useMessageStore.getState().setLoading(true);
    expect(useMessageStore.getState().loading).toBe(true);
  });
});
