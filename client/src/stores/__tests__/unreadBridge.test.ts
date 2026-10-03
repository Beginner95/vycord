import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = new Map<string, (p: unknown) => void>();
vi.mock('@/services/websocket', () => ({
  WS_OPEN_EVENT: 'ws_open',
  wsService: { on: vi.fn((ev: string, cb: (p: unknown) => void) => { handlers.set(ev, cb); return () => handlers.delete(ev); }) },
}));
vi.mock('@/services/api', () => ({
  apiService: { getUnread: vi.fn(async () => []), markChannelRead: vi.fn(), getReadReceipts: vi.fn(async () => ({ others_max_read_at: null, others_max_read_message_id: null })) },
}));

vi.mock('@/services/audio', () => ({ audioService: { playIncomingMessage: vi.fn() } }));

import { apiService } from '@/services/api';
import { audioService } from '@/services/audio';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { initUnreadBridge } from '../unreadBridge';

const api = vi.mocked(apiService);

beforeEach(() => {
  handlers.clear();
  api.getUnread.mockClear();
  api.getReadReceipts.mockClear();
  useServerStore.setState({ currentChannel: null });
  vi.mocked(audioService.playIncomingMessage).mockClear();
  useAuthStore.setState({ user: { id: 'me' } as never });
});

const activity = (over: Record<string, unknown> = {}) => ({
  op: 'create', server_id: 's2', channel_id: 'c9', message_id: 'm1',
  created_at: '2026-10-03T10:00:00Z', author_user_id: 'u2', ...over,
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

  // VYC-105: звук на сообщение в любом канале любого сервера, не только открытом.
  describe('incoming message sound', () => {
    it('plays for someone else\'s message in a channel that is not open', () => {
      useServerStore.setState({ currentChannel: { id: 'c1', server_id: 's1', name: 'g', type: 'text' } as never });
      const off = initUnreadBridge();
      handlers.get('channel_activity')!(activity());
      expect(audioService.playIncomingMessage).toHaveBeenCalledTimes(1);
      off();
    });

    it('plays for a guest message (no author user)', () => {
      const off = initUnreadBridge();
      handlers.get('channel_activity')!(activity({ author_user_id: null }));
      expect(audioService.playIncomingMessage).toHaveBeenCalledTimes(1);
      off();
    });

    it('is silent for my own message', () => {
      const off = initUnreadBridge();
      handlers.get('channel_activity')!(activity({ author_user_id: 'me' }));
      expect(audioService.playIncomingMessage).not.toHaveBeenCalled();
      off();
    });

    it('is silent for a deletion', () => {
      const off = initUnreadBridge();
      handlers.get('channel_activity')!(activity({ op: 'delete' }));
      expect(audioService.playIncomingMessage).not.toHaveBeenCalled();
      off();
    });
  });
});
