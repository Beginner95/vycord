import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useT } from '@/i18n';
import { apiService } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useMessageStore } from '@/stores/messageStore';
import { useVoicePlaybackStore } from '@/stores/voicePlaybackStore';
import { useMediaPlayback } from '@/hooks/useMediaPlayback';
import { useSelfHealingSrc } from '@/hooks/useSelfHealingSrc';
import { formatTime } from '@/utils/formatTime';
import { logger } from '@/utils/logger';
import { waveformFromBase64 } from '@/voice/waveform';
import { VoiceWaveform } from './VoiceWaveform';
import type { Attachment } from '@/types';
import './VoiceMessage.css';

/** Пузырь голосового (spec §3.3). Не «аудиофайл»: без имени и скачивания. */
export function VoiceMessage({ att }: { att: Attachment }) {
  const t = useT();
  const meId = useAuthStore((s) => s.user?.id);
  const rate = useVoicePlaybackStore((s) => s.rate);
  const cycleRate = useVoicePlaybackStore((s) => s.cycle);
  const healed = useSelfHealingSrc(att.id, att.url);
  // Локальная копия: пузырь гаснет сразу, не дожидаясь store/WS.
  const [listened, setListened] = useState(att.listened);
  useEffect(() => setListened(att.listened), [att.listened]);

  const isOwn = !!meId && att.user_id === meId;
  const onPlay = () => {
    if (!meId || isOwn || listened !== false) return;
    setListened(true);
    useMessageStore.getState().applyListened({ attachment_id: att.id, user_id: meId }, meId);
    apiService.markVoiceListened(att.id).catch((err: unknown) => {
      // Косметика и идемпотентно на сервере: без отката, только в лог.
      logger.error('Failed to mark voice listened', err, { module: 'chat' });
    });
  };
  // Проба длительности: у WebM из MediaRecorder duration = Infinity и seekable пуст.
  const probing = useRef(false);
  const media = useMediaPlayback<HTMLAudioElement>({ onPlay });

  useEffect(() => { if (media.ref.current) media.ref.current.playbackRate = rate; }, [rate, media.ref]);

  const values = useMemo(() => waveformFromBase64(att.waveform), [att.waveform]);
  const metaSec = (att.duration_ms ?? 0) / 1000;
  // WebM из MediaRecorder отдаёт Infinity — тогда верим метаданным (spec §3.3).
  const totalSec = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : metaSec;
  const progress = totalSec > 0 ? Math.min(1, media.current / totalSec) : 0;
  const shown = media.playing || media.current > 0 ? media.current : metaSec;

  return (
    <div className="voice-msg" role="group" aria-label={t('voice.message')}>
      <button type="button" className="voice-msg-play" onClick={media.toggle} aria-label={media.playing ? t('voice.pause') : t('voice.play')}>
        {media.playing ? <Pause size={18} strokeWidth={1.8} /> : <Play size={18} strokeWidth={1.8} />}
      </button>
      <div className="voice-msg-body">
        <VoiceWaveform values={values} progress={progress} durationSec={totalSec} onSeek={(f) => media.seek(f * totalSec)} />
        <div className="voice-msg-meta">
          <span className="voice-msg-time">{formatTime(shown)}</span>
          {!!meId && listened === false && <span className="voice-msg-dot" role="img" aria-label={t('voice.unlistened')} />}
        </div>
      </div>
      <button type="button" className="voice-msg-rate" onClick={cycleRate} aria-label={t('voice.speed', { rate: `${rate}x` })}>
        {`${rate}x`}
      </button>
      <audio {...media.mediaProps} src={healed.src} preload="metadata" onError={healed.onError}
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          el.playbackRate = rate;
          media.mediaProps.onLoadedMetadata(e);
          if (!Number.isFinite(el.duration)) {
            // Известный приём: прыжок в «бесконечность» заставляет браузер посчитать длительность.
            probing.current = true;
            el.currentTime = 1e101;
          }
        }}
        onDurationChange={(e) => {
          const el = e.currentTarget;
          media.mediaProps.onDurationChange(e);
          if (probing.current && Number.isFinite(el.duration)) {
            probing.current = false;
            el.currentTime = 0;
          }
        }}
        onTimeUpdate={(e) => { if (!probing.current) media.mediaProps.onTimeUpdate(e); }} />
    </div>
  );
}
