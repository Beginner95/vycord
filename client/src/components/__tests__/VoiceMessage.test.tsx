// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup, act } from '@testing-library/react';
import { VoiceMessage } from '@/components/VoiceMessage';
import { apiService } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useVoicePlaybackStore } from '@/stores/voicePlaybackStore';
import { waveformToBase64 } from '@/voice/waveform';
import type { Attachment } from '@/types';

const att = (over: Partial<Attachment> = {}): Attachment => ({
  id: 'v1', channel_id: 'c', user_id: 'author', kind: 'audio', file_name: 'voice.weba', content_type: 'audio/webm',
  size_bytes: 10, url: '/api/v1/attachments/v1/content?sig=x', created_at: '', is_voice: true, duration_ms: 4200,
  waveform: waveformToBase64(new Array(64).fill(128)), listened: false, ...over,
});

describe('VoiceMessage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ user: { id: 'me' } } as never);
    useVoicePlaybackStore.setState({ rate: 1 });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  it('64 столбика и длительность из duration_ms', () => {
    const { container } = render(<VoiceMessage att={att()} />);
    expect(container.querySelectorAll('.voice-msg-bar')).toHaveLength(64);
    expect(container.querySelector('.voice-msg-time')?.textContent).toBe('0:04');
  });

  it('узкая волна — меньше столбиков, чтобы не вылезать за пузырь', () => {
    let cb: ResizeObserverCallback = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(fn: ResizeObserverCallback) { cb = fn; }
      observe() {}
      disconnect = disconnect;
    });
    try {
      const { container, unmount } = render(<VoiceMessage att={att()} />);
      act(() => cb([{ contentRect: { width: 150 } } as ResizeObserverEntry], {} as ResizeObserver));
      expect(container.querySelectorAll('.voice-msg-bar')).toHaveLength(38);
      unmount();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('infinite duration falls back: Infinity у <audio> не показывается', () => {
    const { container } = render(<VoiceMessage att={att()} />);
    const audio = container.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { value: Infinity, configurable: true });
    fireEvent.loadedMetadata(audio);
    expect(container.textContent).not.toMatch(/Infinity|NaN/);
    expect(container.querySelector('.voice-msg-time')?.textContent).toBe('0:04');
  });

  it('корень — role=group', () => {
    const { container } = render(<VoiceMessage att={att()} />);
    expect(container.querySelector('.voice-msg')?.getAttribute('role')).toBe('group');
  });

  it('Infinity: проба currentTime=1e101, затем durationchange сбрасывает в 0 без POST и play', () => {
    const spy = vi.spyOn(apiService, 'markVoiceListened').mockResolvedValue();
    const { container } = render(<VoiceMessage att={att()} />);
    const audio = container.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { value: Infinity, configurable: true });
    Object.defineProperty(audio, 'currentTime', { value: 0, writable: true, configurable: true });
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(1e101);
    fireEvent.timeUpdate(audio); // браузер шлёт timeupdate на пробе — не должен попасть в состояние
    expect(container.querySelector('.voice-msg-time')?.textContent).toBe('0:04');
    Object.defineProperty(audio, 'duration', { value: 4.2, configurable: true });
    fireEvent.durationChange(audio);
    expect(audio.currentTime).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect(container.querySelector('.voice-msg-time')?.textContent).toBe('0:04');
    expect(screen.getByRole('button', { name: /play|Воспроизвести|Слушать/i })).toBeTruthy();
  });

  it('точка у не-прослушанного; первый onPlay шлёт POST один раз и гасит точку', () => {
    const spy = vi.spyOn(apiService, 'markVoiceListened').mockResolvedValue();
    const { container } = render(<VoiceMessage att={att()} />);
    expect(container.querySelector('.voice-msg-dot')).not.toBeNull();
    const audio = container.querySelector('audio')!;
    fireEvent.play(audio);
    fireEvent.play(audio);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('v1');
    expect(container.querySelector('.voice-msg-dot')).toBeNull();
  });

  it('автор не шлёт POST и своей игрой точку не гасит', () => {
    const spy = vi.spyOn(apiService, 'markVoiceListened').mockResolvedValue();
    const { container } = render(<VoiceMessage att={att({ user_id: 'me' })} />);
    fireEvent.play(container.querySelector('audio')!);
    expect(spy).not.toHaveBeenCalled();
    expect(container.querySelector('.voice-msg-dot')).not.toBeNull();
  });

  it('гостю (нет user, listened:false из WS) точки нет и POST нет', () => {
    useAuthStore.setState({ user: null } as never);
    const spy = vi.spyOn(apiService, 'markVoiceListened').mockResolvedValue();
    const { container } = render(<VoiceMessage att={att({ listened: false })} />);
    fireEvent.play(container.querySelector('audio')!);
    expect(container.querySelector('.voice-msg-dot')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('скорость циклится и применяется к audio', () => {
    const { container } = render(<VoiceMessage att={att()} />);
    fireEvent.click(screen.getByRole('button', { name: /1x|Скорость|speed/i }));
    expect(container.querySelector('audio')!.playbackRate).toBe(1.5);
    expect(container.querySelector('.voice-msg-rate')?.textContent).toBe('1.5x');
  });

  it('клавиатура на волне двигает позицию на ±5 с', () => {
    const { container } = render(<VoiceMessage att={att({ duration_ms: 60_000 })} />);
    const audio = container.querySelector('audio')!;
    // jsdom не реализует HTMLMediaElement: делаем currentTime обычным свойством.
    Object.defineProperty(audio, 'currentTime', { value: 0, writable: true, configurable: true });
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    expect(audio.currentTime).toBe(5);
  });
});
