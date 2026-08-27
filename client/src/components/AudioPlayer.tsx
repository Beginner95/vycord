import { useRef, useState } from 'react';
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
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
    } else {
      el.pause();
    }
  };

  return (
    <div className="audio-player">
      <button type="button" className="audio-play-btn" onClick={toggle} aria-label={fileName}>
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
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
    </div>
  );
}
