import { afterEach, describe, expect, it, vi } from 'vitest';

const wsListeners = new Map<string, (p: unknown) => void>();
const guestListeners = new Map<string, (p: unknown) => void>();

vi.mock('@/services/websocket', () => ({
  wsService: {
    send: vi.fn(),
    on: vi.fn((type: string, cb: (p: unknown) => void) => {
      wsListeners.set(type, cb);
      return () => wsListeners.delete(type);
    }),
  },
}));

vi.mock('@/services/guestGateway', () => ({
  guestGateway: {
    send: vi.fn(),
    on: vi.fn((type: string, cb: (p: unknown) => void) => {
      guestListeners.set(type, cb);
      return () => guestListeners.delete(type);
    }),
  },
}));

import { wsService } from '@/services/websocket';
import { guestGateway } from '@/services/guestGateway';
import { callBus, setCallTransport } from '../callBus';

afterEach(() => {
  setCallTransport('account');
  vi.clearAllMocks();
});

describe('callBus', () => {
  it('sends through the hub for an account', () => {
    callBus.send('mic_muted');
    expect(wsService.send).toHaveBeenCalledWith('mic_muted', {});
    expect(guestGateway.send).not.toHaveBeenCalled();
  });

  it('sends through the guest gateway for a guest, and only what the gateway accepts', () => {
    setCallTransport('guest');

    callBus.send('mic_muted');
    callBus.send('voice_joined', { channel_id: 'c1' });

    expect(guestGateway.send).toHaveBeenCalledWith('mic_muted', {});
    expect(guestGateway.send).toHaveBeenCalledTimes(1);
    expect(wsService.send).not.toHaveBeenCalled();
  });

  it('hears events from either transport and unsubscribes from both', () => {
    const heard: unknown[] = [];
    const off = callBus.on('mic_muted', (p) => heard.push(p));

    wsListeners.get('mic_muted')?.({ user_id: 'u1' });
    guestListeners.get('mic_muted')?.({ user_id: 'u2' });
    expect(heard).toEqual([{ user_id: 'u1' }, { user_id: 'u2' }]);

    off();
    expect(wsListeners.has('mic_muted')).toBe(false);
    expect(guestListeners.has('mic_muted')).toBe(false);
  });
});
