import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = new Map<string, (p: unknown) => void>();
vi.mock('@/services/websocket', () => ({
  WS_OPEN_EVENT: 'ws_open',
  wsService: { on: vi.fn((ev: string, cb: (p: unknown) => void) => { handlers.set(ev, cb); return () => handlers.delete(ev); }) },
}));
vi.mock('@/services/api', () => ({
  apiService: { getUnread: vi.fn(async () => []), markChannelRead: vi.fn(), getReadReceipts: vi.fn(async () => ({ others_max_read_at: null, others_max_read_message_id: null })) },
}));

import { apiService } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { initUnreadBridge } from '../unreadBridge';

const api = vi.mocked(apiService);

beforeEach(() => {
  handlers.clear();
  api.getUnread.mockClear();
  api.getReadReceipts.mockClear();
  useServerStore.setState({ currentChannel: null });
});

describe('unreadBridge', () => {
  // Final review finding 1.
  it('ws_open reloads receipts for the open channel', () => {
    useServerStore.setState({ currentChannel: { id: 'c7', server_id: 's1', name: 'g', type: 'text' } as never });
    const off = initUnreadBridge();
    api.getReadReceipts.mockClear();
    handlers.get('ws_open')!(undefined);
    expect(api.getUnread).toHaveBeenCalledTimes(2);
    expect(api.getReadReceipts).toHaveBeenCalledWith('c7');
    off();
  });

  it('ws_open without an open channel loads no receipts', () => {
    const off = initUnreadBridge();
    handlers.get('ws_open')!(undefined);
    expect(api.getReadReceipts).not.toHaveBeenCalled();
    off();
  });
});
