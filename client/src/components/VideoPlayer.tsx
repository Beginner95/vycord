import { useRef, useState } from 'react';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useT } from '@/i18n';
import { notifyPlaying } from '@/utils/chatMediaCoordinator';
import './VideoPlayer.css';

interface VideoPlayerProps {
  src: string;
  autoPlay?: boolean;
  lightbox?: boolean;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Свой плеер, а не голый <video controls>: те же причины, что и у AudioPlayer —
 * нативный контрол выглядит по-разному в каждом движке и не попадает в тему.
 * Один компонент переиспользуется и в ленте (миниатюра, hover-реveal бара),
 * и в лайтбоксе (autoPlay со звуком, бар виден постоянно) — размер и режим
 * задаются пропами lightbox/autoPlay, вся логика общая.
 */
export function VideoPlayer({ src, autoPlay = false, lightbox = false }: VideoPlayerProps) {
  const t = useT();
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);

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

  const toggleMute = () => {
    const el = ref.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  };

  return (
    <div className={`video-player${lightbox ? ' is-lightbox' : ''}`}>
      <video
        ref={ref}
        className="video-player-media"
        src={src}
        preload="metadata"
        autoPlay={autoPlay}
        onClick={toggle}
        onPlay={(e) => { setPlaying(true); notifyPlaying(e.currentTarget); }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />

      <div className="video-player-bar">
        <button type="button" className="video-play-btn" onClick={toggle} aria-label={playing ? t('chat.pause') : t('chat.play')}>
          {playing ? <Pause size={16} strokeWidth={1.8} /> : <Play size={16} strokeWidth={1.8} />}
        </button>

        <input
          type="range"
          className="video-seek"
          aria-label={t('chat.seekPosition')}
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

        <span className="video-time">{formatTime(current)} / {formatTime(duration)}</span>

        <button type="button" className="video-mute-btn" onClick={toggleMute} aria-label={muted ? t('chat.unmute') : t('chat.mute')}>
          {muted ? <VolumeX size={16} strokeWidth={1.8} /> : <Volume2 size={16} strokeWidth={1.8} />}
        </button>
      </div>
    </div>
  );
}
