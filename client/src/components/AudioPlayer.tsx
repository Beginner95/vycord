import { useRef, useState } from 'react';
import { useT } from '@/i18n';
import { notifyPlaying } from '@/utils/chatMediaCoordinator';
import './AudioPlayer.css';

interface AudioPlayerProps {
  src: string;
  fileName: string;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Свой плеер, а не голый <audio controls>: нативный контрол выглядит
 * по-разному в каждом движке и не попадает в тему приложения.
 */
export function AudioPlayer({ src, fileName }: AudioPlayerProps) {
  const t = useT();
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      // Останавливаем предыдущий элемент ДО play(), а не в onPlay: на мобильных
      // видео/аудио делят одну аппаратную аудио-сессию, и пока прежний элемент
      // не отпущен, новый play() может тихо не сработать — onPlay для него
      // просто не наступит.
      notifyPlaying(el);
      void el.play();
    } else {
      el.pause();
    }
  };

  return (
    <div className="audio-player">
      <button type="button" className="audio-play-btn" onClick={toggle} aria-label={playing ? t('chat.pause') : t('chat.play')}>
        {playing ? '❚❚' : '▶'}
      </button>

      <div className="audio-body">
        <span className="audio-name" title={fileName}>{fileName}</span>
        <input
          type="range"
          className="audio-seek"
          min={0}
          max={duration || 0}
          step={0.1}
          value={current}
          onChange={(e) => {
            const el = ref.current;
            if (!el) return;
            el.currentTime = Number(e.target.value);
            setCurrent(el.currentTime);
          }}
        />
      </div>

      <span className="audio-time">{formatTime(current)} / {formatTime(duration)}</span>

      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onPlay={(e) => { setPlaying(true); notifyPlaying(e.currentTarget); }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
    </div>
  );
}
