import { createContext, useEffect, useRef } from 'react';
import { useCallStore } from '@/stores/callStore';
import { groupCallService } from '@/services/groupCall';
import { callBus } from '@/services/callBus';
import { registerCallAudioElement, resetCallAudioSink } from '@/components/call/callAudioSinks';
import { useT } from '@/i18n';
import './CallAudioHost.css';

/**
 * true — звук удалённых участников играет CallAudioHost, смонтированный на
 * уровне MobileShell: экран звонка передаёт это в useCallStageModel
 * ({ externalAudio }), и <video> плиток остаются немыми (без двойного звука).
 * По умолчанию false: гостевая оболочка и десктоп звучат через плитки.
 */
export const CallAudioHostContext = createContext(false);

/**
 * Постоянный «хост звука» группового звонка на мобильной оболочке.
 *
 * Раньше звук играли только <video> плиток экрана звонка, а MobileShell
 * монтирует лишь два верхних экрана стека: свёрнутый звонок или лайтбокс
 * поверх чата над звонком размонтировали экран — и звук пропадал. Хост не
 * зависит от стека навигации: он смонтирован, пока звонок не `idle`.
 *
 * Играет только камеро-/микрофонные потоки `participants[].stream`. Звук
 * демонстрации экрана (`remoteScreenStreams`) остаётся на главном видео
 * focus-вида экрана звонка — иначе шаринг звучал бы дважды.
 */
export function CallAudioHost() {
  const participants = useCallStore((s) => s.participants);
  const volumes = useCallStore((s) => s.participantVolumes);
  useCallMediaSession();
  // Звонок закончился — следующий начнётся с устройства вывода по умолчанию.
  useEffect(() => resetCallAudioSink, []);

  return (
    <div className="call-audio-host" aria-hidden="true">
      {participants.map((p) => p.stream && (
        <ParticipantAudio
          key={p.userId}
          userId={p.userId}
          stream={p.stream}
          volume={volumes[p.userId] ?? 100}
        />
      ))}
    </div>
  );
}

function ParticipantAudio({ userId, stream, volume }: { userId: string; stream: MediaStream; volume: number }) {
  const ref = useRef<HTMLAudioElement>(null);

  // Реестр для setSinkId (переключатель динамика экрана звонка).
  useEffect(() => {
    const el = ref.current;
    return el ? registerCallAudioElement(el) : undefined;
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    // Тот же обход autoplay-политики, что attachStreamToElement в
    // useCallStageModel: muted play() разрешён всегда, а снять mute с уже
    // играющего элемента браузер не запрещает.
    const start = () => {
      if (!alive || !el.paused) return;
      el.muted = true;
      const played = el.play();
      // jsdom и старые браузеры возвращают не промис.
      if (!played || typeof played.then !== 'function') { el.muted = false; return; }
      played
        .then(() => { if (alive) el.muted = false; })
        .catch((err: unknown) => {
          if (alive) el.muted = false;
          console.warn(`[GC] audio host play() failed uid=${userId.slice(0, 8)}:`, err);
        });
    };
    el.srcObject = stream;
    start();
    // Аудиотрек нередко приходит в уже выданный поток позже (ontrack по
    // одному треку) — элемент мог остановиться на пустом потоке.
    stream.addEventListener?.('addtrack', start);
    return () => {
      alive = false;
      stream.removeEventListener?.('addtrack', start);
      el.pause();
      el.srcObject = null;
    };
  }, [stream, userId]);

  useEffect(() => {
    const el = ref.current;
    if (el) el.volume = Math.min(1, Math.max(0, volume / 100));
  }, [volume]);

  return <audio ref={ref} autoPlay data-user-id={userId} />;
}

type SessionAction = Parameters<MediaSession['setActionHandler']>[0];
const HANGUP = 'hangup' as SessionAction;
const TOGGLE_MIC = 'togglemicrophone' as SessionAction;

function setHandler(ms: MediaSession, action: SessionAction, handler: MediaSessionActionHandler | null): void {
  // Неподдерживаемое действие бросает TypeError — это нормально.
  try { ms.setActionHandler(action, handler); } catch { /* не поддерживается */ }
}

function toggleMute(): void {
  // Без микрофона кнопка экрана звонка выключена (disabled={!isMicAvailable}) —
  // системная кнопка тоже ничего не делает.
  if (!useCallStore.getState().isMicAvailable) return;
  // Тот же путь, что handleToggleMute в useCallStageModel.
  const muted = groupCallService.toggleMuteAudio();
  useCallStore.setState({ isMuted: muted });
  callBus.send(muted ? 'mic_muted' : 'mic_unmuted', {});
}

/**
 * MediaSession на время звонка: карточка «Звонок · VYCORD» в шторке/на
 * экране блокировки и системные кнопки «положить трубку»/«микрофон» —
 * это держит медиасессию живой, когда приложение свёрнуто.
 */
function useCallMediaSession(): void {
  const t = useT();
  const channelName = useCallStore((s) => s.callChannelName);
  const isMuted = useCallStore((s) => s.isMuted);
  const title = channelName || t('call.mediaSessionTitle');
  const artist = t('call.mediaSessionArtist');

  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!ms) return;
    try {
      if (typeof MediaMetadata !== 'undefined') {
        ms.metadata = new MediaMetadata({
          title,
          artist,
          artwork: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          ],
        });
      }
    } catch { /* нет MediaMetadata */ }
    return () => {
      try { ms.metadata = null; } catch { /* ignore */ }
    };
  }, [title, artist]);

  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!ms) return;
    try { ms.playbackState = 'playing'; } catch { /* ignore */ }
    setHandler(ms, HANGUP, () => useCallStore.getState().leave());
    setHandler(ms, TOGGLE_MIC, toggleMute);
    return () => {
      setHandler(ms, HANGUP, null);
      setHandler(ms, TOGGLE_MIC, null);
      try { ms.playbackState = 'none'; } catch { /* ignore */ }
      if (typeof ms.setMicrophoneActive === 'function') {
        try { void ms.setMicrophoneActive(false).catch(() => {}); } catch { /* ignore */ }
      }
    };
  }, []);

  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!ms || typeof ms.setMicrophoneActive !== 'function') return;
    try { void ms.setMicrophoneActive(!isMuted).catch(() => {}); } catch { /* ignore */ }
  }, [isMuted]);
}
