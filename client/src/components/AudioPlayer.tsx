import { Pause, Play } from 'lucide-react';
import { useT } from '@/i18n';
import { useMediaPlayback } from '@/hooks/useMediaPlayback';
import { useSelfHealingSrc } from '@/hooks/useSelfHealingSrc';
import { formatTime } from '@/utils/formatTime';
import './AudioPlayer.css';

interface AudioPlayerProps {
  attachmentId: string;
  src: string;
  fileName: string;
}

/**
 * Свой плеер, а не голый <audio controls>: нативный контрол выглядит
 * по-разному в каждом движке и не попадает в тему приложения.
 */
export function AudioPlayer({ attachmentId, src, fileName }: AudioPlayerProps) {
  const t = useT();
  const media = useMediaPlayback<HTMLAudioElement>();
  const healed = useSelfHealingSrc(attachmentId, src);

  return (
    <div className="audio-player">
      <button type="button" className="audio-play-btn" onClick={media.toggle} aria-label={media.playing ? t('chat.pause') : t('chat.play')}>
        {media.playing ? <Pause size={16} strokeWidth={1.8} /> : <Play size={16} strokeWidth={1.8} />}
      </button>

      <div className="audio-body">
        <span className="audio-name" title={fileName}>{fileName}</span>
        <input
          type="range"
          className="audio-seek"
          aria-label={t('chat.seekPosition')}
          min={0}
          max={media.duration || 0}
          step={0.1}
          value={media.current}
          onChange={(e) => media.seek(Number(e.target.value))}
        />
      </div>

      <span className="audio-time">{formatTime(media.current)} / {formatTime(media.duration)}</span>

      <audio {...media.mediaProps} src={healed.src} preload="metadata" onError={healed.onError} />
    </div>
  );
}
