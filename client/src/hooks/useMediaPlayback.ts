import { useRef, useState, type SyntheticEvent } from 'react';
import { notifyPlaying } from '@/utils/chatMediaCoordinator';

/** Общее ядро плееров чата (AudioPlayer, VoiceMessage). */
export function useMediaPlayback<T extends HTMLMediaElement>(opts: { onPlay?: () => void } = {}) {
  const ref = useRef<T>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      // Останавливаем предыдущий элемент ДО play(), а не в onPlay: на мобильных
      // медиа делят одну аудио-сессию, и пока прежний не отпущен, новый play()
      // может тихо не сработать.
      notifyPlaying(el);
      void el.play()?.catch(() => {});
    } else {
      el.pause();
    }
  };

  const seek = (sec: number) => {
    const el = ref.current;
    if (!el) return;
    el.currentTime = sec;
    setCurrent(el.currentTime);
  };

  const mediaProps = {
    ref,
    onPlay: (e: SyntheticEvent<T>) => { setPlaying(true); notifyPlaying(e.currentTarget); opts.onPlay?.(); },
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onTimeUpdate: (e: SyntheticEvent<T>) => setCurrent(e.currentTarget.currentTime),
    onLoadedMetadata: (e: SyntheticEvent<T>) => setDuration(e.currentTarget.duration),
    onDurationChange: (e: SyntheticEvent<T>) => setDuration(e.currentTarget.duration),
  };

  return { ref, playing, current, duration, toggle, seek, mediaProps };
}
