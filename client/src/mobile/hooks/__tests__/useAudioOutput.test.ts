// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { ru } from '@/i18n/locales/ru';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mockOutputDevices(devices: Partial<MediaDeviceInfo>[]): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { enumerateDevices: vi.fn().mockResolvedValue(devices) },
    configurable: true,
  });
}

// SUPPORTED — `'setSinkId' in HTMLMediaElement.prototype` — is computed once
// at module load, so each scenario resets the module registry and imports
// fresh after arranging the prototype, matching the pattern used for other
// module-scoped feature detection in this repo (themeStore.themeColor.test.ts).
describe('useAudioOutput — setSinkId absent from the prototype', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId;
    mockOutputDevices([
      { deviceId: 'a', kind: 'audiooutput', label: 'Speakers' },
      { deviceId: 'b', kind: 'audiooutput', label: 'Headphones' },
    ]);
  });

  it('is unsupported even with multiple output devices', async () => {
    const { useAudioOutput } = await import('@/mobile/hooks/useAudioOutput');
    const { result } = renderHook(() => useAudioOutput(vi.fn()));
    await act(async () => {});
    expect(result.current.supported).toBe(false);
  });
});

describe('useAudioOutput — setSinkId supported', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { value: vi.fn(), configurable: true });
  });

  afterEach(() => {
    delete (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId;
  });

  it('cycles through output devices in order and wraps around, calling applySinkId with the deviceId', async () => {
    mockOutputDevices([
      { deviceId: 'a', kind: 'audiooutput', label: 'Speakers' },
      { deviceId: 'b', kind: 'audiooutput', label: 'Headphones' },
      { deviceId: 'mic1', kind: 'audioinput', label: 'Built-in mic' },
    ]);
    const applySinkId = vi.fn();
    const { useAudioOutput } = await import('@/mobile/hooks/useAudioOutput');
    const { result } = renderHook(() => useAudioOutput(applySinkId));
    await act(async () => {});
    expect(result.current.supported).toBe(true);

    act(() => result.current.cycle());
    expect(applySinkId).toHaveBeenLastCalledWith('b');

    act(() => result.current.cycle());
    expect(applySinkId).toHaveBeenLastCalledWith('a');
    expect(applySinkId).toHaveBeenCalledTimes(2);
  });

  it('is unsupported with exactly one output device', async () => {
    mockOutputDevices([{ deviceId: 'a', kind: 'audiooutput', label: 'Speakers' }]);
    const { useAudioOutput } = await import('@/mobile/hooks/useAudioOutput');
    const { result } = renderHook(() => useAudioOutput(vi.fn()));
    await act(async () => {});
    expect(result.current.supported).toBe(false);
  });

  it('falls back to call.speakerDefault when the current device has no label', async () => {
    mockOutputDevices([
      { deviceId: 'a', kind: 'audiooutput', label: '' },
      { deviceId: 'b', kind: 'audiooutput', label: '' },
    ]);
    const { useAudioOutput } = await import('@/mobile/hooks/useAudioOutput');
    const { result } = renderHook(() => useAudioOutput(vi.fn()));
    await act(async () => {});
    // `currentLabel = current?.label || t('call.speakerDefault')` — a device
    // with an empty label falls through the `||` to the translated fallback
    // string itself, not just any non-empty string (Minor M8,
    // task-final-fix-report.md). The locale store defaults to 'ru' with no
    // override in jsdom tests (no localStorage entry), matching every other
    // test in this repo that asserts on translated text.
    expect(result.current.currentLabel).toBe(ru.call.speakerDefault);
  });
});
