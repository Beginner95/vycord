// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { ru } from '@/i18n/locales/ru';

function mediaDevice(
  id: string,
  kind: 'audioinput' | 'audiooutput' | 'videoinput',
  label: string,
): MediaDeviceInfo {
  return { deviceId: id, groupId: '', kind, label, toJSON: () => ({}) } as MediaDeviceInfo;
}

async function seedOutputDevices(devices: MediaDeviceInfo[]): Promise<void> {
  const { useMediaDeviceStore } = await import('@/stores/mediaDeviceStore');
  useMediaDeviceStore.setState({
    devices: {
      audioinput: devices.filter((d) => d.kind === 'audioinput'),
      audiooutput: devices.filter((d) => d.kind === 'audiooutput'),
      videoinput: [],
    },
    selected: { audioinput: '', audiooutput: '', videoinput: '' },
  });
}

// SUPPORTED — `'setSinkId' in HTMLMediaElement.prototype` — is computed once
// at module load, so each scenario resets the module registry and imports
// fresh after arranging the prototype, matching the pattern used for other
// module-scoped feature detection in this repo (themeStore.themeColor.test.ts).
describe('useAudioOutput — setSinkId absent from the prototype', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    delete (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId;
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('is unsupported even with multiple output devices', async () => {
    await seedOutputDevices([
      mediaDevice('a', 'audiooutput', 'Speakers'),
      mediaDevice('b', 'audiooutput', 'Headphones'),
    ]);
    const { useAudioOutput } = await import('@/mobile/hooks/useAudioOutput');
    const { result } = renderHook(() => useAudioOutput(vi.fn()));
    expect(result.current.supported).toBe(false);
  });
});

describe('useAudioOutput — setSinkId supported', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { value: vi.fn(), configurable: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId;
  });

  it('cycles through output devices in order and wraps around, calling applySinkId with the deviceId', async () => {
    await seedOutputDevices([
      mediaDevice('a', 'audiooutput', 'Speakers'),
      mediaDevice('b', 'audiooutput', 'Headphones'),
      mediaDevice('mic1', 'audioinput', 'Built-in mic'),
    ]);
    const applySinkId = vi.fn();
    const { useAudioOutput } = await import('@/mobile/hooks/useAudioOutput');
    const { result } = renderHook(() => useAudioOutput(applySinkId));
    expect(result.current.supported).toBe(true);

    act(() => result.current.cycle());
    expect(applySinkId).toHaveBeenLastCalledWith('b');

    act(() => result.current.cycle());
    expect(applySinkId).toHaveBeenLastCalledWith('a');
    expect(applySinkId).toHaveBeenCalledTimes(2);
  });

  it('is unsupported with exactly one output device', async () => {
    await seedOutputDevices([mediaDevice('a', 'audiooutput', 'Speakers')]);
    const { useAudioOutput } = await import('@/mobile/hooks/useAudioOutput');
    const { result } = renderHook(() => useAudioOutput(vi.fn()));
    expect(result.current.supported).toBe(false);
  });

  it('falls back to call.speakerDefault when the current device has no label', async () => {
    await seedOutputDevices([
      mediaDevice('a', 'audiooutput', ''),
      mediaDevice('b', 'audiooutput', ''),
    ]);
    const { useAudioOutput } = await import('@/mobile/hooks/useAudioOutput');
    const { result } = renderHook(() => useAudioOutput(vi.fn()));
    // currentLabel = current?.label || t('call.speakerDefault') — пустая метка
    // проваливается сквозь || к переведённому фолбэку (Minor M8). Список теперь
    // приходит из стора, где псевдоустройства default/communications отфильтрованы.
    expect(result.current.currentLabel).toBe(ru.call.speakerDefault);
  });
});
