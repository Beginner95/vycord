import { useEffect, useRef, useState, type MutableRefObject } from 'react';

type Kind = 'audio' | 'video';
type InitialCapture = Record<Kind, MediaStream | null>;

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/**
 * Локальное превью до входа: микрофон (индикатор уровня) и камера. Выключенное
 * устройство освобождается — иначе браузер продолжал бы показывать «камера /
 * микрофон используется»; включение захватывает его заново. Первый захват —
 * всё включённое одним запросом (один диалог разрешений). Всё гасится при
 * уходе с экрана. `denied` — включённое устройство сейчас недоступно (по
 * видам: отказ одного не прячет работающее второе).
 */
export function useLocalPreview({ micOn, videoOn }: { micOn: boolean; videoOn: boolean }) {
  /** Первый захват завершён — дальше каждым устройством владеет useDevice. */
  const [ready, setReady] = useState(false);
  const wantRef = useRef({ audio: micOn, video: videoOn });
  wantRef.current = { audio: micOn, video: videoOn };
  /** Треки первого захвата — передаются useDevice своего вида. */
  const initialRef = useRef<InitialCapture>({ audio: null, video: null });

  useEffect(() => {
    const want = wantRef.current;
    if (!want.audio && !want.video) {
      setReady(true);
      return;
    }
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ audio: want.audio, video: want.video })
      .then((media) => {
        if (cancelled) {
          stopTracks(media);
          return;
        }
        const audio = media.getAudioTracks();
        const video = media.getVideoTracks();
        initialRef.current = {
          audio: audio.length > 0 ? new MediaStream(audio) : null,
          video: video.length > 0 ? new MediaStream(video) : null,
        };
      })
      // Отказ общего запроса ничего не решает: браузер отклоняет его целиком,
      // даже если недоступен только один вид. useDevice каждого вида запросит
      // своё отдельно и сам отметит отказ.
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
      // Ушли с экрана раньше, чем useDevice забрали треки первого захвата.
      stopTracks(initialRef.current.audio);
      stopTracks(initialRef.current.video);
      initialRef.current = { audio: null, video: null };
    };
  }, []);

  const mic = useDevice('audio', micOn, ready, initialRef);
  const camera = useDevice('video', videoOn, ready, initialRef);
  return { mic: mic.stream, camera: camera.stream, denied: mic.denied || camera.denied };
}

/** Одно устройство после первого захвата: «вкл» — держит (или захватывает
 *  заново), «выкл» — стопает. */
function useDevice(
  kind: Kind,
  on: boolean,
  ready: boolean,
  initialRef: MutableRefObject<InitialCapture>,
): { stream: MediaStream | null; denied: boolean } {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const initial = initialRef.current[kind];
    initialRef.current[kind] = null;
    if (!on) {
      // Выключили, пока шёл первый захват. Выключенное устройство не
      // «недоступно» — предупреждение о нём снимается.
      stopTracks(initial);
      setDenied(false);
      return;
    }
    let cancelled = false;
    let acquired: MediaStream | null = null;

    (initial ? Promise.resolve(initial) : navigator.mediaDevices.getUserMedia({ [kind]: true }))
      .then((media) => {
        if (cancelled) {
          stopTracks(media);
          return;
        }
        acquired = media;
        setStream(media);
        setDenied(false);
      })
      .catch(() => {
        if (!cancelled) setDenied(true);
      });

    return () => {
      cancelled = true;
      stopTracks(acquired);
      setStream(null);
    };
  }, [kind, on, ready, initialRef]);

  return { stream, denied };
}
