import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wsService } from '@/services/websocket';
import { mockSockets } from '@/test/setup';

/** Полезная нагрузка всех join_channel, отправленных в данный сокет. */
function joinChannelPayloads(socket: { sent: string[] }): unknown[] {
  return socket.sent
    .map((raw) => JSON.parse(raw))
    .filter((msg) => msg.type === 'join_channel')
    .map((msg) => msg.payload);
}

describe('websocket: подписка на канал переживает реконнект', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wsService.disconnect();
  });

  afterEach(() => {
    wsService.disconnect();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('после реконнекта заново сообщает серверу просматриваемый канал', () => {
    wsService.connect('token');
    const first = mockSockets[mockSockets.length - 1];
    first.emitOpen();

    wsService.joinChannel('chan-1');
    expect(joinChannelPayloads(first)).toEqual([{ channel_id: 'chan-1' }]);

    // Соединение оборвалось (вытеснение дубль-сессии, блип сети) и поднялось
    // заново. Серверный Client создаётся с CurrentChannelID = nil, поэтому
    // без повторного join_channel SendToChannel перестаёт доставлять
    // chat_message этому пользователю до перезагрузки страницы.
    first.emitClose(1006);
    vi.advanceTimersByTime(60_000);

    const second = mockSockets[mockSockets.length - 1];
    expect(second).not.toBe(first);
    second.emitOpen();

    expect(joinChannelPayloads(second)).toEqual([{ channel_id: 'chan-1' }]);
  });

  it('не восстанавливает канал, если клиент из него вышел', () => {
    wsService.connect('token');
    const first = mockSockets[mockSockets.length - 1];
    first.emitOpen();

    wsService.joinChannel('chan-1');
    wsService.joinChannel(null);

    first.emitClose(1006);
    vi.advanceTimersByTime(60_000);
    const second = mockSockets[mockSockets.length - 1];
    second.emitOpen();

    expect(joinChannelPayloads(second)).toEqual([]);
  });

  it('доносит join_channel, отправленный до открытия сокета', () => {
    wsService.joinChannel('chan-1');
    wsService.connect('token');

    const socket = mockSockets[mockSockets.length - 1];
    socket.emitOpen();

    expect(joinChannelPayloads(socket)).toEqual([{ channel_id: 'chan-1' }]);
  });
});
