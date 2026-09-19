import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Video, VideoOff, Loader2 } from 'lucide-react';
import { hasStoredGuestSession, useGuestCallStore, type GuestEndReason } from '@/stores/guestCallStore';
import { useT, type TKey } from '@/i18n';
import { useMicLevel } from '@/hooks/useMicLevel';
import { GuestCallView } from './GuestCallView';
import { guestErrorText } from './guestErrors';
import './GuestPage.css';

/**
 * Страница гостя: вход в звонок по ссылке без аккаунта
 * (docs/superpowers/specs/2026-09-17-guest-call-link-design.md, раздел 4).
 *
 * Живёт вне PrivateRoute и намеренно не трогает ни authStore, ни wsService —
 * у гостя нет аккаунта. Секрет приходит во fragment и стирается из адреса
 * сразу: в query он попал бы в логи nginx, а в адресной строке остался бы в
 * истории браузера.
 */

function readSecretFromFragment(): string {
  const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  if (raw) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return raw.trim();
}

function supportsCalls(): boolean {
  return typeof RTCPeerConnection !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

const END_REASON_KEYS: Record<GuestEndReason, TKey> = {
  left: 'guest.endedLeft',
  kicked: 'guest.endedKicked',
  link_revoked: 'guest.endedRevoked',
  guests_disabled: 'guest.endedGuestsDisabled',
  call_ended: 'guest.endedTitle',
  rejected: 'guest.endedRejected',
  lobby_timeout: 'guest.endedTimeout',
  disconnected: 'guest.endedDisconnected',
  session_expired: 'guest.endedSessionExpired',
};

export function GuestPage() {
  const t = useT();
  const [secret] = useState(readSecretFromFragment);
  // Fragment стёрт при первом заходе, поэтому после перезагрузки его нет —
  // гостя возвращает сессия из sessionStorage, а не ссылка.
  const [hasSession] = useState(hasStoredGuestSession);
  const phase = useGuestCallStore((s) => s.phase);
  const preview = useGuestCallStore((s) => s.preview);
  const previewError = useGuestCallStore((s) => s.previewError);
  const loadPreview = useGuestCallStore((s) => s.loadPreview);
  const resume = useGuestCallStore((s) => s.resume);
  const reset = useGuestCallStore((s) => s.reset);

  useEffect(() => {
    if (hasSession) {
      resume();
      return;
    }
    if (!secret) return;
    void loadPreview(secret);
  }, [hasSession, secret, loadPreview, resume]);

  useEffect(() => () => reset(), [reset]);

  if (!supportsCalls()) {
    return <GuestNotice title={t('guest.unsupported')} hint={t('guest.unsupportedHint')} />;
  }

  if (!secret && !hasSession) {
    return <GuestNotice title={t('guest.linkMissing')} hint={t('guest.linkMissingHint')} />;
  }

  if (previewError && phase === 'entry') {
    return (
      <GuestNotice
        title={guestErrorText(previewError, t)}
        hint={t('guest.linkMissingHint')}
      />
    );
  }

  if (phase === 'ended') {
    return <GuestEnded />;
  }

  if (phase === 'in_call' || phase === 'connecting' || phase === 'resuming') {
    return <GuestCallView />;
  }

  if (phase === 'lobby' || phase === 'joining') {
    return <GuestLobby />;
  }

  // Первый кадр до эффекта, который запускает resume().
  if (hasSession && phase === 'entry') {
    return null;
  }

  return <GuestEntry secret={secret} previewReady={Boolean(preview)} />;
}

// ─── Общие мелочи ────────────────────────────────────────────────────────────

function GuestNotice({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="guest-page">
      <div className="guest-card guest-card-narrow">
        <h1 className="guest-title">{title}</h1>
        {hint && <p className="guest-hint">{hint}</p>}
        {children}
      </div>
    </div>
  );
}

function GuestHeader() {
  const t = useT();
  const preview = useGuestCallStore((s) => s.preview);
  if (!preview) return null;
  return (
    <div className="guest-header">
      <span className="guest-header-server">{preview.server_name}</span>
      <span className="guest-header-channel">#{preview.channel_name}</span>
      <span className="guest-header-count">
        {t('guest.inCallNow', { count: preview.participant_count })}
      </span>
    </div>
  );
}

/** Локальное превью камеры и микрофона до входа. Гасится при уходе с экрана. */
function useLocalPreview(enabled: boolean) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let acquired: MediaStream | null = null;

    navigator.mediaDevices
      .getUserMedia({ audio: true, video: true })
      .then((media) => {
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        acquired = media;
        setStream(media);
      })
      .catch(() => {
        if (!cancelled) setDenied(true);
      });

    return () => {
      cancelled = true;
      acquired?.getTracks().forEach((track) => track.stop());
      setStream(null);
    };
  }, [enabled]);

  return { stream, denied };
}

// ─── Экран входа ─────────────────────────────────────────────────────────────

function GuestEntry({ secret, previewReady }: { secret: string; previewReady: boolean }) {
  const t = useT();
  const join = useGuestCallStore((s) => s.join);
  const joinError = useGuestCallStore((s) => s.joinError);
  const phase = useGuestCallStore((s) => s.phase);

  const [name, setName] = useState(() => localStorage.getItem('vycord.guest.name') ?? '');
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const { stream, denied } = useLocalPreview(true);
  const level = useMicLevel(stream, muted);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const submit = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    localStorage.setItem('vycord.guest.name', trimmed);
    void join(secret, trimmed, { muted, videoOff });
  }, [join, muted, name, secret, videoOff]);

  return (
    <div className="guest-page">
      <div className="guest-card">
        <GuestHeader />
        <h1 className="guest-title">{t('guest.joinTitle')}</h1>

        <div className="guest-preview">
          <video ref={videoRef} autoPlay playsInline muted className={videoOff ? 'is-hidden' : undefined} />
          {videoOff && <div className="guest-preview-off">{t('guest.cameraOff')}</div>}
          <div className="guest-meter">
            <div className="level-meter" style={{ '--meter-level': Math.min(1, level) } as React.CSSProperties} />
          </div>
        </div>

        {denied && (
          <p className="guest-warning">
            {t('guest.mediaDenied')} {t('guest.mediaDeniedHint')}
          </p>
        )}

        <div className="guest-toggles">
          <button
            type="button"
            className={`btn btn-ghost guest-toggle${muted ? ' is-off' : ''}`}
            onClick={() => setMuted((v) => !v)}
            title={muted ? t('guest.micOff') : t('guest.micOn')}
          >
            {muted ? <MicOff size={18} strokeWidth={1.8} /> : <Mic size={18} strokeWidth={1.8} />}
            <span>{muted ? t('guest.micOff') : t('guest.micOn')}</span>
          </button>
          <button
            type="button"
            className={`btn btn-ghost guest-toggle${videoOff ? ' is-off' : ''}`}
            onClick={() => setVideoOff((v) => !v)}
            title={videoOff ? t('guest.cameraOff') : t('guest.cameraOn')}
          >
            {videoOff ? <VideoOff size={18} strokeWidth={1.8} /> : <Video size={18} strokeWidth={1.8} />}
            <span>{videoOff ? t('guest.cameraOff') : t('guest.cameraOn')}</span>
          </button>
        </div>

        <label className="guest-field">
          <span className="guest-field-label">{t('guest.nameLabel')}</span>
          <input
            className="input"
            value={name}
            maxLength={32}
            placeholder={t('guest.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            data-autofocus
          />
        </label>

        {joinError && <p className="guest-error">{guestErrorText(joinError, t)}</p>}

        <button
          type="button"
          className="btn btn-primary guest-submit"
          disabled={!name.trim() || !previewReady || phase === 'joining'}
          onClick={submit}
        >
          {t('guest.askToJoin')}
        </button>
      </div>
    </div>
  );
}

// ─── Лобби ───────────────────────────────────────────────────────────────────

function GuestLobby() {
  const t = useT();
  const cancelLobby = useGuestCallStore((s) => s.cancelLobby);

  return (
    <div className="guest-page">
      <div className="guest-card guest-card-narrow">
        <GuestHeader />
        <Loader2 size={28} strokeWidth={1.8} className="guest-spinner" />
        <h1 className="guest-title">{t('guest.lobbyTitle')}</h1>
        <p className="guest-hint">{t('guest.lobbyHint')}</p>
        <button type="button" className="btn btn-secondary" onClick={() => void cancelLobby()}>
          {t('guest.cancel')}
        </button>
      </div>
    </div>
  );
}

// ─── Конец ───────────────────────────────────────────────────────────────────

function GuestEnded() {
  const t = useT();
  const endReason = useGuestCallStore((s) => s.endReason);
  const reasonKey = endReason ? END_REASON_KEYS[endReason] : 'guest.endedTitle';

  return (
    <GuestNotice title={t('guest.endedTitle')} hint={t(reasonKey)}>
      <div className="guest-ended-actions">
        <p className="guest-hint">{t('guest.signUpPrompt')}</p>
        <a className="btn btn-secondary" href="/login">
          {t('guest.signUp')}
        </a>
        <button type="button" className="btn btn-ghost" onClick={() => window.close()}>
          {t('guest.close')}
        </button>
      </div>
    </GuestNotice>
  );
}

