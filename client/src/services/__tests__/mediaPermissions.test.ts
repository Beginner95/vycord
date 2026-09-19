import { describe, it, expect, vi } from 'vitest';
import { getDeniedMediaKinds } from '@/services/mediaPermissions';

describe('getDeniedMediaKinds', () => {
  it('reports nothing denied when the electronAPI bridge is absent (web build)', async () => {
    const result = await getDeniedMediaKinds(undefined);
    expect(result).toEqual({ cameraDenied: false, microphoneDenied: false });
  });

  it('reports nothing denied when the build predates this IPC method', async () => {
    const result = await getDeniedMediaKinds({} as never);
    expect(result).toEqual({ cameraDenied: false, microphoneDenied: false });
  });

  it('reports both denied when macOS TCC denied both', async () => {
    const api = { getMediaAccessStatus: vi.fn().mockResolvedValue({ camera: 'denied', microphone: 'denied' }) };
    const result = await getDeniedMediaKinds(api);
    expect(result).toEqual({ cameraDenied: true, microphoneDenied: true });
  });

  it('treats "restricted" the same as "denied"', async () => {
    const api = { getMediaAccessStatus: vi.fn().mockResolvedValue({ camera: 'restricted', microphone: 'granted' }) };
    const result = await getDeniedMediaKinds(api);
    expect(result).toEqual({ cameraDenied: true, microphoneDenied: false });
  });

  it('reports nothing denied for granted/not-determined', async () => {
    const api = { getMediaAccessStatus: vi.fn().mockResolvedValue({ camera: 'granted', microphone: 'not-determined' }) };
    const result = await getDeniedMediaKinds(api);
    expect(result).toEqual({ cameraDenied: false, microphoneDenied: false });
  });

  it('fails safe (nothing denied) if the IPC call rejects', async () => {
    const api = { getMediaAccessStatus: vi.fn().mockRejectedValue(new Error('ipc down')) };
    const result = await getDeniedMediaKinds(api);
    expect(result).toEqual({ cameraDenied: false, microphoneDenied: false });
  });

  it('asks the main process to prompt (TCC) first when requestMediaAccess exists', async () => {
    const api = {
      getMediaAccessStatus: vi.fn().mockResolvedValue({ camera: 'not-determined', microphone: 'not-determined' }),
      requestMediaAccess: vi.fn().mockResolvedValue({ camera: 'denied', microphone: 'granted' }),
    };
    const result = await getDeniedMediaKinds(api);
    expect(api.requestMediaAccess).toHaveBeenCalledTimes(1);
    expect(api.getMediaAccessStatus).not.toHaveBeenCalled();
    expect(result).toEqual({ cameraDenied: true, microphoneDenied: false });
  });

  it('falls back to the plain status check if the prompt IPC rejects', async () => {
    const api = {
      getMediaAccessStatus: vi.fn().mockResolvedValue({ camera: 'denied', microphone: 'granted' }),
      requestMediaAccess: vi.fn().mockRejectedValue(new Error('ipc down')),
    };
    const result = await getDeniedMediaKinds(api);
    expect(result).toEqual({ cameraDenied: true, microphoneDenied: false });
  });
});
