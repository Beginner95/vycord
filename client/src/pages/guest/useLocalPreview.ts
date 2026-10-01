import { useEffect, useRef, useState } from 'react';

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/**
 * Локальное превью до входа: микрофон (индикатор уровня) и камера. Выключенная
 * камера освобождается — скрытый <video> её не отпускает, и браузер продолжал
 * бы показывать «камера используется»; включение захватывает её заново.
 * Первый захват — микрофон и камера одним запросом (один диалог разрешений).
 * Всё гасится при уходе с экрана.
 */
export function useLocalPreview(videoOn: boolean) {
  const [mic, setMic] = useState<MediaStream | null>(null);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [denied, setDenied] = useState(false);
  /** Первый захват завершён — дальше камерой владеет эффект ниже. */
  const [ready, setReady] = useState(false);
  const videoOnRef = useRef(videoOn);
  videoOnRef.current = videoOn;
  /** Камера из первого захвата — передаётся эффекту камеры. */
  const initialCameraRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;
    let acquired: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({ audio: true, video: videoOnRef.current })
      .then((media) => {
        if (cancelled) {
          stopTracks(media);
          return;
        }
        acquired = media;
        setMic(new MediaStream(media.getAudioTracks()));
        const video = media.getVideoTracks();
        if (video.length > 0) initialCameraRef.current = new MediaStream(video);
      })
      .catch(() => {
        if (!cancelled) setDenied(true);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
      acquired?.getAudioTracks().forEach((track) => track.stop());
      // Ушли с экрана раньше, чем эффект камеры забрал камеру первого захвата.
      stopTracks(initialCameraRef.current);
      initialCameraRef.current = null;
      setMic(null);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const initial = initialCameraRef.current;
    initialCameraRef.current = null;
    if (!videoOn) {
      // Выключили, пока шёл первый захват.
      stopTracks(initial);
      return;
    }
    let cancelled = false;
    let acquired: MediaStream | null = null;

    (initial ? Promise.resolve(initial) : navigator.mediaDevices.getUserMedia({ video: true }))
      .then((media) => {
        if (cancelled) {
          stopTracks(media);
          return;
        }
        acquired = media;
        setCamera(media);
      })
      .catch(() => {
        if (!cancelled) setDenied(true);
      });

    return () => {
      cancelled = true;
      stopTracks(acquired);
      setCamera(null);
    };
  }, [ready, videoOn]);

  return { mic, camera, denied };
}
