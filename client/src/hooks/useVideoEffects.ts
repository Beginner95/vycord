import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  VISION_ASSETS_BASE,
  VideoBackgroundEngine,
  type BackgroundMode,
  type VideoBackgroundStatus,
} from '@/services/videoBackground';
import { useBackgroundStore } from '@/stores/backgroundStore';

export interface UseVideoEffectsResult {
  /** Поток для локального превью: оригинал при mode='none', иначе канвас+аудио. */
  output: MediaStream | null;
  status: VideoBackgroundStatus;
}

/**
 * Применяет эффект фона к входному видеопотоку.
 *
 * - mode='none' или input=null → движок простаивает, onTrack(null) откатывает
 *   подмену в звонке, output === input.
 * - иначе → грузит модель, строит канвас-конвейер и сообщает трек через
 *   onTrack (мы пушим его в звонок через setCameraOutput).
 * - следит за заменой видео-трека внутри input (ре-аквайр камеры в групповом
 *   звонке меняет трек без смены стрима) — перезапускает конвейер.
 * - при размонтировании сначала откатывает трек, потом dispose движка.
 */
export function useVideoEffects(
  input: MediaStream | null,
  mode: BackgroundMode,
  backgroundImageId: string | null,
  onTrack: (track: MediaStreamTrack | null) => void,
): UseVideoEffectsResult {
  const list = useBackgroundStore((s) => s.list);
  const [status, setStatus] = useState<VideoBackgroundStatus>('idle');
  const onTrackRef = useRef(onTrack);
  onTrackRef.current = onTrack;
  /** Последний отправленный трек — onTrack зовём только при смене. */
  const sentTrackRef = useRef<MediaStreamTrack | null | undefined>(undefined);

  const engineRef = useRef<VideoBackgroundEngine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = new VideoBackgroundEngine({ assetsBase: VISION_ASSETS_BASE });
    engineRef.current.onStatusChange = setStatus;
  }

  const backgroundUrl = mode === 'image' && backgroundImageId
    ? (list?.find((b) => b.id === backgroundImageId)?.url ?? null)
    : null;

  const sendTrack = useCallback((track: MediaStreamTrack | null): void => {
    if (sentTrackRef.current === track) return;
    sentTrackRef.current = track;
    onTrackRef.current(track);
  }, []);

  // SINGLE-FLIGHT (review Task 6): apply, пришедшие, пока предыдущий ещё
  // крутится в setInput/setMode, встают в хвост цепочки и выполняются строго
  // по очереди — без interleaving (иначе параллельные loadModel могли бы
  // задвоить сегментер). seq-метка даёт latest-wins: устаревший apply из
  // очереди пропускается, если после него запрошен более свежий. Seq
  // пере-проверяется и ПОСЛЕ каждого await (см. run) — чек до await'ов не
  // спасает от гона: заснувший в setInput/setMode run может проснуться уже
  // после синхронного отката в 'none'.
  const applySeqRef = useRef(0);
  const applyChainRef = useRef<Promise<void> | null>(null);
  const apply = useCallback((): void => {
    const engine = engineRef.current;
    if (!engine) return;
    const seq = ++applySeqRef.current;
    if (mode === 'none' || !input) {
      // Откат обязан успеть синхронно: служба возвращает оригинальный трек в
      // том же тике. Путь без await'ов — в очередь не встаём, движок в
      // 'none' сам гасит конвейер; устаревшие queued-apply выше seq скипнутся.
      engine.setMode('none', null).catch(() => {});
      sendTrack(null);
      return;
    }
    const run = async (): Promise<void> => {
      const eng = engineRef.current;
      if (!eng || applySeqRef.current !== seq) return;
      try {
        await eng.setInput(input);
        // После await'а мог прийти более свежий apply (в т.ч. синхронный
        // откат в 'none', инкремент seq, unmount) — устаревший run не должен
        // продолжать: иначе поверх отката дописался бы setMode(effect) и
        // sendTrack(track) в состоянии 'none'.
        if (applySeqRef.current !== seq || engineRef.current !== eng) return;
        await eng.setMode(mode, backgroundUrl);
        if (applySeqRef.current !== seq || engineRef.current !== eng) return;
        // Модель могла не загрузиться (status 'error') — тогда трек не
        // меняем: в эфир уходит оригинальная камера.
        sendTrack(eng.outputTrack);
      } catch {
        sendTrack(null);
      }
    };
    // Первый apply стартует синхронно, остальные — в хвост цепочки.
    applyChainRef.current = applyChainRef.current
      ? applyChainRef.current.then(run).catch(() => {})
      : run();
  }, [input, mode, backgroundUrl, sendTrack]);

  useEffect(() => {
    apply();
  }, [apply]);

  // Модель грузится асинхронно: как только движок готов — канал трека мог
  // появиться после apply() (в ленивых конвейерах). Ре-применяем по 'ready'.
  useEffect(() => {
    const engine = engineRef.current!;
    engine.onStatusChange = (s) => {
      setStatus(s);
      if (s === 'ready') apply();
    };
    return () => {
      engine.onStatusChange = null;
    };
  }, [apply]);

  // Замена видео-трека внутри того же стрима (ре-аквайр VYC-96 и смена
  // устройства) — движок должен перестроиться на новом треке.
  useEffect(() => {
    if (!input) return;
    const onChange = (e: Event): void => {
      if ((e as MediaStreamTrackEvent).track.kind !== 'video') return;
      apply();
    };
    input.addEventListener('addtrack', onChange);
    input.addEventListener('removetrack', onChange);
    return () => {
      input.removeEventListener('addtrack', onChange);
      input.removeEventListener('removetrack', onChange);
    };
  }, [input, apply]);

  // Размонтирование: откат трека строго до dispose — служба должна успеть
  // вернуть оригинальный камерный трек на сендер. engineRef сбрасываем, чтобы
  // застрявшие в цепочке apply не оживили dispose'нутый движок (и re-mount
  // в StrictMode получил бы свежий экземпляр).
  useEffect(() => {
    const engine = engineRef.current!;
    return () => {
      onTrackRef.current(null);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const output = useMemo(() => {
    if (mode === 'none' || !input) return input;
    const track = engineRef.current?.outputTrack;
    return track ? buildOutput(input, track) : input;
  }, [input, mode, backgroundUrl, status]);

  return { output, status: mode === 'none' ? 'idle' : status };
}

function buildOutput(input: MediaStream, videoTrack: MediaStreamTrack): MediaStream {
  const out = new MediaStream([videoTrack]);
  for (const t of input.getAudioTracks()) out.addTrack(t);
  return out;
}