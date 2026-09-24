// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import type { CallStageModel } from '@/components/useCallStageModel';
import { t } from '@/i18n';

afterEach(() => { cleanup(); });

type OverflowModel = Pick<CallStageModel, 'guestLinksEnabled' | 'isGuestMode' | 'isScreenSharing' | 'handleToggleScreenShare'>;

const model = (over: Partial<OverflowModel> = {}): OverflowModel => ({
  guestLinksEnabled: false,
  isGuestMode: false,
  isScreenSharing: false,
  handleToggleScreenShare: vi.fn(),
  ...over,
});

// CAN_SHARE — `'getDisplayMedia' in (navigator.mediaDevices ?? {})` — is
// computed once at module load, so each scenario resets the module registry
// and imports fresh after arranging navigator.mediaDevices (same pattern as
// useAudioOutput.test.ts / themeStore.themeColor.test.ts).
describe('useCallOverflowItems — платформа без getDisplayMedia', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
  });

  it('никогда не показывает пункт демонстрации экрана', async () => {
    const { useCallOverflowItems } = await import('@/mobile/call/useCallOverflowItems');
    const { result } = renderHook(() => useCallOverflowItems(model({ isScreenSharing: true }), false, vi.fn()));
    expect(result.current.some((i) => i.label === t('call.shareScreen') || i.label === t('call.stopScreenShare'))).toBe(false);
  });

  it('всегда показывает качество и громкость', async () => {
    const { useCallOverflowItems } = await import('@/mobile/call/useCallOverflowItems');
    const { result } = renderHook(() => useCallOverflowItems(model(), false, vi.fn()));
    const labels = result.current.map((i) => i.label);
    expect(labels).toContain(t('call.qualityDetails'));
    expect(labels).toContain(t('mobile.callVolumeAction'));
  });
});

describe('useCallOverflowItems — платформа с getDisplayMedia', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia: vi.fn() },
      configurable: true,
    });
  });

  it('показывает «Демонстрировать экран», пока не шарит, и открывает подшторку качества', async () => {
    const { useCallOverflowItems } = await import('@/mobile/call/useCallOverflowItems');
    const onOpenSub = vi.fn();
    const { result } = renderHook(() => useCallOverflowItems(model({ isScreenSharing: false }), false, onOpenSub));
    const share = result.current.find((i) => i.label === t('call.shareScreen'));
    expect(share).toBeDefined();
    share!.onClick();
    expect(onOpenSub).toHaveBeenCalledWith('screenQuality');
  });

  it('показывает «Остановить демонстрацию» во время демонстрации и не открывает подшторку', async () => {
    const { useCallOverflowItems } = await import('@/mobile/call/useCallOverflowItems');
    const onOpenSub = vi.fn();
    const handleToggleScreenShare = vi.fn();
    const { result } = renderHook(() =>
      useCallOverflowItems(model({ isScreenSharing: true, handleToggleScreenShare }), false, onOpenSub),
    );
    const stop = result.current.find((i) => i.label === t('call.stopScreenShare'));
    expect(stop).toBeDefined();
    stop!.onClick();
    expect(handleToggleScreenShare).toHaveBeenCalledTimes(1);
    expect(onOpenSub).not.toHaveBeenCalled();
  });

  describe('пункт «Гости»', () => {
    it('отсутствует без права приглашать и без гостей в звонке', async () => {
      const { useCallOverflowItems } = await import('@/mobile/call/useCallOverflowItems');
      const { result } = renderHook(() => useCallOverflowItems(model(), false, vi.fn()));
      expect(result.current.some((i) => i.label === t('call.ctlGuests'))).toBe(false);
    });

    it('появляется, когда ссылки разрешены и участник не гость', async () => {
      const { useCallOverflowItems } = await import('@/mobile/call/useCallOverflowItems');
      const { result } = renderHook(() => useCallOverflowItems(model({ guestLinksEnabled: true }), false, vi.fn()));
      expect(result.current.some((i) => i.label === t('call.ctlGuests'))).toBe(true);
    });

    it('скрыто для самого гостя, даже если ссылки разрешены на сервере', async () => {
      const { useCallOverflowItems } = await import('@/mobile/call/useCallOverflowItems');
      const { result } = renderHook(() =>
        useCallOverflowItems(model({ guestLinksEnabled: true, isGuestMode: true }), false, vi.fn()),
      );
      expect(result.current.some((i) => i.label === t('call.ctlGuests'))).toBe(false);
    });

    it('появляется, если гости уже в канале, даже без права приглашать', async () => {
      const { useCallOverflowItems } = await import('@/mobile/call/useCallOverflowItems');
      const { result } = renderHook(() => useCallOverflowItems(model(), true, vi.fn()));
      expect(result.current.some((i) => i.label === t('call.ctlGuests'))).toBe(true);
    });

    it('открывает подшторку guests по клику', async () => {
      const { useCallOverflowItems } = await import('@/mobile/call/useCallOverflowItems');
      const onOpenSub = vi.fn();
      const { result } = renderHook(() => useCallOverflowItems(model({ guestLinksEnabled: true }), false, onOpenSub));
      result.current.find((i) => i.label === t('call.ctlGuests'))!.onClick();
      expect(onOpenSub).toHaveBeenCalledWith('guests');
    });
  });
});
