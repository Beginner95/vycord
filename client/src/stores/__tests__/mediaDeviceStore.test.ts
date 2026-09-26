// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

function mediaDevice(over: Partial<MediaDeviceInfo>): MediaDeviceInfo {
  return {
    deviceId: 'x-device',
    groupId: 'g',
    kind: 'audioinput',
    label: 'X',
    toJSON: () => ({}),
    ...over,
  } as MediaDeviceInfo;
}

function mockEnumerate(devices: MediaDeviceInfo[]): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { enumerateDevices: vi.fn().mockResolvedValue(devices) },
    configurable: true,
  });
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe('mediaDeviceStore: refreshDevices', () => {
  it('разносит устройства по kind и выкидывает псевдоустройства default/communications', async () => {
    mockEnumerate([
      mediaDevice({ deviceId: 'default', kind: 'audioinput', label: 'Default Mic' }),
      mediaDevice({ deviceId: 'communications', kind: 'audiooutput', label: 'Comms Speakers' }),
      mediaDevice({ deviceId: 'mic1', kind: 'audioinput', label: 'Mic A' }),
      mediaDevice({ deviceId: 'mic2', kind: 'audioinput', label: 'Mic B' }),
      mediaDevice({ deviceId: 'spk1', kind: 'audiooutput', label: 'Speakers' }),
      mediaDevice({ deviceId: 'cam1', kind: 'videoinput', label: 'Webcam' }),
    ]);
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    await useMediaDeviceStore.getState().refreshDevices();
    const { devices } = useMediaDeviceStore.getState();
    expect(devices.audioinput.map((d) => d.deviceId)).toEqual(['mic1', 'mic2']);
    expect(devices.audiooutput.map((d) => d.deviceId)).toEqual(['spk1']);
    expect(devices.videoinput.map((d) => d.deviceId)).toEqual(['cam1']);
  });

  it('не падает без navigator.mediaDevices (jsdom, гости без периферии)', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    await expect(useMediaDeviceStore.getState().refreshDevices()).resolves.toBeUndefined();
  });
});

describe('mediaDeviceStore: prune', () => {
  it('сбрасывает выбор пропавшего устройства в ""', async () => {
    mockEnumerate([mediaDevice({ deviceId: 'mic1', kind: 'audioinput', label: 'Mic A' })]);
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    useMediaDeviceStore.getState().setSelected('audioinput', 'mic1');
    useMediaDeviceStore.getState().setSelected('videoinput', 'cam-missing');
    await useMediaDeviceStore.getState().refreshDevices();
    const { selected } = useMediaDeviceStore.getState();
    expect(selected.audioinput).toBe('mic1');
    expect(selected.videoinput).toBe('');
  });
});

describe('mediaDeviceStore: setSelected и персистентность', () => {
  it('setSelected пишет в localStorage; новая инициализация читает сохранённое', async () => {
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    useMediaDeviceStore.getState().setSelected('audioinput', 'mic-saved');
    expect(JSON.parse(localStorage.getItem('vycord_media_devices')!)).toEqual({
      audioinput: 'mic-saved', audiooutput: '', videoinput: '',
    });

    vi.resetModules();
    const { useMediaDeviceStore: fresh } = await import('@/stores/mediaDeviceStore');
    expect(fresh.getState().selected.audioinput).toBe('mic-saved');
  });

  it('невалидное содержимое localStorage не ломает инициализацию', async () => {
    localStorage.setItem('vycord_media_devices', '{broken json');
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    expect(useMediaDeviceStore.getState().selected).toEqual({
      audioinput: '', audiooutput: '', videoinput: '',
    });
  });
});

describe('mediaDeviceStore: ensurePermission', () => {
  it('запрашивает getUserMedia и останавливает поток', async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const gum = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        getUserMedia: gum,
      },
      configurable: true,
    });
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    await useMediaDeviceStore.getState().ensurePermission('audioinput');
    expect(gum).toHaveBeenCalledWith({ audio: true });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(useMediaDeviceStore.getState().permissions.audioinput).toBe('granted');
  });

  it('отказ разрешения помечает kind как denied без проброса ошибки', async () => {
    const gum = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        getUserMedia: gum,
      },
      configurable: true,
    });
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    await expect(useMediaDeviceStore.getState().ensurePermission('videoinput')).resolves.toBeUndefined();
    expect(useMediaDeviceStore.getState().permissions.videoinput).toBe('denied');
  });
});
