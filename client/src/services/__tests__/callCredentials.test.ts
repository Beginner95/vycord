import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';

vi.mock('@/services/api', () => ({
  apiService: {
    getVoiceToken: vi.fn(async () => ({ token: 'channel-token' })),
    getCallVoiceToken: vi.fn(async () => ({ token: 'call-token' })),
  },
}));
vi.mock('@/services/iceConfig', () => ({ getIceServers: vi.fn(async () => []) }));

import {
  accountCallCredentials,
  getCallCredentials,
  setCallCredentials,
  publicWebUrl,
  markDirectCallRoom,
} from '../callCredentials';
import { apiService } from '@/services/api';

afterEach(() => {
  setCallCredentials(accountCallCredentials);
  vi.unstubAllEnvs();
});

describe('callCredentials', () => {
  it('defaults to the account implementation', () => {
    expect(getCallCredentials()).toBe(accountCallCredentials);
  });

  it('swaps the implementation for a guest call', async () => {
    const guest = {
      getVoiceToken: vi.fn().mockResolvedValue({ token: 'guest-token' }),
      getIceServers: vi.fn().mockResolvedValue([]),
    };
    setCallCredentials(guest);

    await expect(getCallCredentials().getVoiceToken('room')).resolves.toEqual({ token: 'guest-token' });
    expect(guest.getVoiceToken).toHaveBeenCalledWith('room');
  });

  it('builds guest links against the configured public web origin', () => {
    vi.stubEnv('VITE_PUBLIC_WEB_URL', 'https://front.example.test/');
    expect(publicWebUrl()).toBe('https://front.example.test');
  });
});

describe('accountCallCredentials.getVoiceToken', () => {
  beforeEach(() => {
    markDirectCallRoom(null);
    vi.clearAllMocks();
  });

  it('для канала ходит в /channels/{id}/voice-token', async () => {
    await expect(accountCallCredentials.getVoiceToken('ch-1')).resolves.toEqual({ token: 'channel-token' });
    expect(apiService.getVoiceToken).toHaveBeenCalledWith('ch-1');
  });

  it('для отмеченной комнаты звонка 1:1 — в /calls/{id}/voice-token', async () => {
    markDirectCallRoom('call-1');
    await expect(accountCallCredentials.getVoiceToken('call-1')).resolves.toEqual({ token: 'call-token' });
    expect(apiService.getCallVoiceToken).toHaveBeenCalledWith('call-1');
    expect(apiService.getVoiceToken).not.toHaveBeenCalled();
  });
});
