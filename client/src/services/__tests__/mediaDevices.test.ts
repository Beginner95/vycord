// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

function stream(): MediaStream {
  return { getTracks: () => [] } as unknown as MediaStream;
}

function mockGetUserMedia(impl: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: impl },
    configurable: true,
  });
}

describe('buildMicConstraints / buildCameraConstraints', () => {
  it('без выбранного устройства возвращает базовые constraints без deviceId', async () => {
    const { buildMicConstraints, buildCameraConstraints } = await import('@/services/mediaDevices');
    expect(buildMicConstraints().deviceId).toBeUndefined();
    expect(buildMicConstraints().channelCount).toEqual({ ideal: 1 });
    expect(buildMicConstraints().sampleRate).toEqual({ ideal: 48000 });
    expect(buildCameraConstraints()).toEqual({});
  });

  it('с выбранным устройством добавляет deviceId: { exact }', async () => {
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    useMediaDeviceStore.getState().setSelected('audioinput', 'mic-42');
    useMediaDeviceStore.getState().setSelected('videoinput', 'cam-7');
    const { buildMicConstraints, buildCameraConstraints } = await import('@/services/mediaDevices');
    expect(buildMicConstraints().deviceId).toEqual({ exact: 'mic-42' });
    expect(buildCameraConstraints().deviceId).toEqual({ exact: 'cam-7' });
  });
});

describe('acquireUserMedia', () => {
  it('после провала выбранного устройства деградирует к дефолтам и возвращает поток', async () => {
    const gum = vi.fn()
      .mockRejectedValueOnce(new DOMException('not available', 'OverconstrainedError'))
      .mockRejectedValueOnce(new DOMException('not available', 'OverconstrainedError'))
      .mockResolvedValueOnce(stream());
    mockGetUserMedia(gum);
    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    useMediaDeviceStore.getState().setSelected('audioinput', 'gone-device');
    const { acquireUserMedia } = await import('@/services/mediaDevices');
    const result = await acquireUserMedia();
    expect(result).not.toBeNull();
    expect(gum).toHaveBeenCalledTimes(3);
    expect(gum.mock.calls[2][0]).toEqual({ audio: true, video: true });
  });

  it('при полном отказе возвращает null; число попыток: 3 без выбора, 5 с выбором', async () => {
    const gum = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    mockGetUserMedia(gum);
    const { acquireUserMedia } = await import('@/services/mediaDevices');
    expect(await acquireUserMedia()).toBeNull();
    expect(gum).toHaveBeenCalledTimes(3);

    const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
    useMediaDeviceStore.getState().setSelected('audioinput', 'mic-42');
    useMediaDeviceStore.getState().setSelected('videoinput', 'cam-7');
    expect(await acquireUserMedia()).toBeNull();
    expect(gum).toHaveBeenCalledTimes(8);
  });
});