// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
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

  it('клик по play останавливает ранее запущенный плеер до старта нового', () => {
    // На мобильных видео/аудио делят одну аудио-сессию: если остановить
    // предыдущий элемент только по событию onPlay нового, play() нового может
    // тихо не сработать и onPlay вовсе не наступит. Поэтому pause() должен
    // случиться синхронно в обработчике клика, до вызова play().
    const { container: c1 } = render(<VideoPlayer src="/clip1.mp4" />);
    const { container: c2 } = render(<VideoPlayer src="/clip2.mp4" />);

    const video1 = c1.querySelector('video') as HTMLVideoElement;
    const video2 = c2.querySelector('video') as HTMLVideoElement;
    const play1Btn = c1.querySelector('.video-play-btn') as HTMLButtonElement;
    const play2Btn = c2.querySelector('.video-play-btn') as HTMLButtonElement;

    video1.play = vi.fn();
    video2.play = vi.fn();
    video1.pause = vi.fn();

    fireEvent.click(play1Btn);
    Object.defineProperty(video1, 'paused', { value: false, configurable: true });

    fireEvent.click(play2Btn);

    expect(video1.pause).toHaveBeenCalledTimes(1);
  });
});
