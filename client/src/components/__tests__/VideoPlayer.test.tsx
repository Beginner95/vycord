// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { VideoPlayer } from '@/components/VideoPlayer';

describe('VideoPlayer', () => {
  it('не показывает нативные контролы — плеер свой', () => {
    const { container } = render(<VideoPlayer src="/clip.mp4" />);

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.hasAttribute('controls')).toBe(false);
    // preload=metadata показывает первый кадр вместо чёрного прямоугольника.
    expect(video?.getAttribute('preload')).toBe('metadata');
  });

  it('плеер не показывает NaN, пока длительность неизвестна', () => {
    // jsdom не реализует HTMLMediaElement, поэтому duration здесь NaN — ровно
    // тот случай, ради которого в formatTime стоит проверка Number.isFinite.
    const { container } = render(<VideoPlayer src="/clip.mp4" />);

    const video = container.querySelector('video')!;
    fireEvent.loadedMetadata(video);

    expect(container.querySelector('.video-time')?.textContent).not.toMatch(/NaN/);
  });

  it('кнопка mute переключает video.muted', () => {
    const { container } = render(<VideoPlayer src="/clip.mp4" />);

    const video = container.querySelector('video') as HTMLVideoElement;
    const muteBtn = container.querySelector('.video-mute-btn') as HTMLButtonElement;
    expect(video.muted).toBe(false);

    fireEvent.click(muteBtn);
    expect(video.muted).toBe(true);

    fireEvent.click(muteBtn);
    expect(video.muted).toBe(false);
  });

  it('в режиме lightbox проставляет autoPlay и модификатор', () => {
    const { container } = render(<VideoPlayer src="/clip.mp4" autoPlay lightbox />);

    expect(container.querySelector('.video-player--lightbox')).not.toBeNull();
    expect(container.querySelector('video')?.hasAttribute('autoplay')).toBe(true);
  });
});
