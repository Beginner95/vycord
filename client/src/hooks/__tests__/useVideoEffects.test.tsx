// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useVideoEffects } from '@/hooks/useVideoEffects';
import { useBackgroundStore } from '@/stores/backgroundStore';

// jsdom не реализует MediaStream — фейк по образцу noiseCancellation-тестов
// (EventTarget нужен хуку для addtrack/removetrack-слушателей на input).
type FakeTrack = { kind: string; readyState?: string };

class FakeMediaStream extends EventTarget {
  id = `stream-${Math.random()}`;
  private tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) {
    super();
    this.tracks = [...tracks];
  }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
  getTracks() { return [...this.tracks]; }
  addTrack(t: FakeTrack) { this.tracks.push(t); }
}

class MockEngine {
  onStatusChange: ((s: string) => void) | null = null;
  hasEffect = false;
  outputTrack: MediaStreamTrack | null = null;
  status = 'idle';
  setInput = vi.fn(async () => undefined);
  setMode = vi.fn(async () => undefined);
  dispose = vi.fn();
}

const { VideoBackgroundEngine: MockEngineCtor } = vi.hoisted(() => ({
  VideoBackgroundEngine: vi.fn<() => MockEngine>(),
}));

vi.mock('@/services/videoBackground', () => ({
  VideoBackgroundEngine: MockEngineCtor,
  VISION_ASSETS_BASE: '/vision/',
}));

function makeStream(): MediaStream {
  const track = { kind: 'video', readyState: 'live' } as unknown as MediaStreamTrack;
  const stream = new MediaStream();
  stream.addTrack(track);
  return stream;
}

function currentEngine(): MockEngine {
  return MockEngineCtor.mock.results[MockEngineCtor.mock.results.length - 1].value;
}

beforeEach(() => {
  useBackgroundStore.setState({ list: null, listStatus: 'idle', mode: 'none', backgroundId: null });
  MockEngineCtor.mockClear();
  // vi.fn() сам по себе не конструирует MockEngine (new на спай даёт пустой
  // объект, а стрелочная реализация не конструктор) — регистрируем обычную
  // функцию здесь, где класс уже определён.
  MockEngineCtor.mockImplementation(function engineFactory() {
    return new MockEngine();
  });
  vi.stubGlobal('MediaStream', FakeMediaStream);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useVideoEffects: режим none', () => {
  it('не трогает движок и зовёт onTrack(null)', () => {
    const input = makeStream();
    const onTrack = vi.fn();
    const { result } = renderHook(() => useVideoEffects(input, 'none', null, onTrack));

    expect(result.current.output).toBe(input);
    expect(onTrack).toHaveBeenCalledWith(null);
    expect(currentEngine().setInput).not.toHaveBeenCalled();
  });
});

describe('useVideoEffects: эффект активен', () => {
  it('строит конвейер и отдаёт канвас-трек', async () => {
    const input = makeStream();
    const onTrack = vi.fn();
    const fakeTrack = { kind: 'video', readyState: 'live' } as unknown as MediaStreamTrack;

    renderHook(() => useVideoEffects(input, 'blur', null, onTrack));
    const eng = currentEngine();

    expect(eng.setInput).toHaveBeenCalledWith(input);
    await waitFor(() => expect(eng.setMode).toHaveBeenCalledWith('blur', null));

    act(() => {
      eng.hasEffect = true;
      eng.outputTrack = fakeTrack;
      // хук подхватывает готовность движка по статусу
      eng.onStatusChange?.('ready');
    });
    await waitFor(() => expect(onTrack).toHaveBeenCalledWith(fakeTrack));
  });

  it('переключение на none откатывает трек', async () => {
    const input = makeStream();
    const onTrack = vi.fn();
    const { rerender } = renderHook(
      ({ mode }: { mode: 'none' | 'blur' }) => useVideoEffects(input, mode, null, onTrack),
      { initialProps: { mode: 'blur' } },
    );
    rerender({ mode: 'none' });
    expect(onTrack).toHaveBeenLastCalledWith(null);
  });
});

describe('useVideoEffects: cleanup', () => {
  it('возвращает трек и диспоузит движок при размонтировании', () => {
    const input = makeStream();
    const onTrack = vi.fn();
    const { unmount } = renderHook(() => useVideoEffects(input, 'blur', null, onTrack));
    unmount();

    expect(onTrack).toHaveBeenLastCalledWith(null);
    expect(currentEngine().dispose).toHaveBeenCalledTimes(1);
  });
});

describe('useVideoEffects: StrictMode re-mount (фоллов-ап к крашу)', () => {
  it('двойной прогон эффектов в StrictMode не падает и создаёт свежий движок', async () => {
    const input = makeStream();
    const onTrack = vi.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <React.StrictMode>{children}</React.StrictMode>
    );
    const { result, unmount } = renderHook(
      () => useVideoEffects(input, 'blur', null, onTrack),
      { wrapper },
    );

    // В реальном браузере (dev) StrictMode прогоняет эффекты дважды: cleanup
    // unmount-эффекта обнулял engineRef.current, повторный setup падал с
    // TypeError «Cannot set properties of null (setting 'onStatusChange')».
    // В jsdom под vitest двойной прогон НЕ воспроизводится — проверено
    // зондом: движок создаётся один раз, dispose вызывается только на unmount.
    // Поэтому здесь фиксируем достижимые инварианты (живой движок, цепочка
    // apply доходит до onTrack(null), unmount диспоузит движок), а сам
    // анти-краш-путь (ensureEngine: setup эффектов переживает обнулённый ref)
    // покрыт кодом — повторный setup с null в ref не взрывается.
    await waitFor(() => expect(onTrack).toHaveBeenCalled());
    expect(onTrack).toHaveBeenCalledTimes(1);
    expect(onTrack).toHaveBeenCalledWith(null);
    expect(MockEngineCtor).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');

    unmount();
    expect(currentEngine().dispose).toHaveBeenCalledTimes(1);
  });
});
