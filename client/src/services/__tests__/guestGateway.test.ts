import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guestGateway, type GuestGatewayEvent } from '../guestGateway';

class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  deliver(type: string, payload: Record<string, unknown> = {}) {
    this.onmessage?.({ data: JSON.stringify({ type, payload }) });
  }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket);
  FakeSocket.last = null;
});

afterEach(() => {
  guestGateway.disconnect();
  vi.unstubAllGlobals();
});

describe('guestGateway', () => {
  it('authenticates in the first frame, never in the URL', () => {
    guestGateway.connect('sess-token', () => {});
    const socket = FakeSocket.last!;
    expect(socket.url).not.toContain('sess-token');

    socket.open();
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'auth', payload: { token: 'sess-token' } });
  });

  it('translates server frames into events', () => {
    const events: GuestGatewayEvent[] = [];
    guestGateway.connect('t', (e) => events.push(e));
    const socket = FakeSocket.last!;
    socket.open();

    socket.deliver('lobby_waiting');
    socket.deliver('admitted', { room_id: 'room-1' });
    socket.deliver('participants', { users: [{ user_id: 'u1', username: 'вася' }], guests: [] });
    socket.deliver('kicked', { reason: 'link_revoked' });

    expect(events).toEqual([
      { type: 'lobby_waiting' },
      { type: 'admitted', room_id: 'room-1' },
      { type: 'participants', users: [{ user_id: 'u1', username: 'вася' }], guests: [] },
      { type: 'kicked', reason: 'link_revoked' },
    ]);
  });

  it('forwards media signals of other participants', () => {
    const events: GuestGatewayEvent[] = [];
    guestGateway.connect('t', (e) => events.push(e));
    const socket = FakeSocket.last!;
    socket.open();

    socket.deliver('mic_muted', { user_id: 'guest:abc' });

    expect(events).toContainEqual({
      type: 'peer_signal',
      signal: 'mic_muted',
      userId: 'guest:abc',
      payload: { user_id: 'guest:abc' },
    });
  });

  it('stops reconnecting after a terminal event', () => {
    guestGateway.connect('t', () => {});
    const socket = FakeSocket.last!;
    socket.open();
    socket.deliver('call_ended');
    socket.close();

    expect(FakeSocket.last).toBe(socket);
    expect(guestGateway.isConnected()).toBe(false);
  });

  it('gives up on a session the server rejected instead of retrying forever', () => {
    vi.useFakeTimers();
    const events: GuestGatewayEvent[] = [];
    guestGateway.connect('dead', (e) => events.push(e));
    const socket = FakeSocket.last!;
    socket.open();
    socket.deliver('session_invalid');
    socket.close();
    vi.advanceTimersByTime(10_000);
    vi.useRealTimers();

    expect(events).toContainEqual({ type: 'session_invalid' });
    expect(FakeSocket.last).toBe(socket);
  });
});
