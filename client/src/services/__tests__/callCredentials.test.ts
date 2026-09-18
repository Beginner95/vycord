import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  accountCallCredentials,
  getCallCredentials,
  setCallCredentials,
  publicWebUrl,
} from '../callCredentials';

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
