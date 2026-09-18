import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, MessageSquare, Send, Users, Loader2 } from 'lucide-react';
import { useGuestCallStore, type GuestEndReason } from '@/stores/guestCallStore';
import { hasKey } from '@/i18n';
import { useT, type TFunc, type TKey } from '@/i18n';
import { Avatar } from '@/components/Avatar';
import { useMicLevel } from '@/hooks/useMicLevel';
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

/**
 * Текст ошибки гостя. Сервер присылает стабильный code — по нему и переводим;
 * если код клиенту неизвестен (старый клиент против нового сервера), остаётся
 * серверный текст, как и в apiErrorText для аккаунта.
 */
function guestErrorText(error: { code?: string; message: string } | null, t: TFunc): string {
  if (!error) return '';
  const key = `errors.${error.code ?? ''}`;
  return error.code && hasKey(key) ? t(key as TKey) : error.message;
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
};

export function GuestPage() {
  const t = useT();
  const [secret] = useState(readSecretFromFragment);
  const phase = useGuestCallStore((s) => s.phase);
  const preview = useGuestCallStore((s) => s.preview);
  const previewError = useGuestCallStore((s) => s.previewError);
  const loadPreview = useGuestCallStore((s) => s.loadPreview);
  const reset = useGuestCallStore((s) => s.reset);

  useEffect(() => {
    if (!secret) return;
    void loadPreview(secret);
  }, [secret, loadPreview]);

  useEffect(() => () => reset(), [reset]);

  if (!supportsCalls()) {
    return <GuestNotice title={t('guest.unsupported')} hint={t('guest.unsupportedHint')} />;
  }

  if (!secret) {
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

  if (phase === 'in_call' || phase === 'connecting') {
    return <GuestCall />;
  }

  if (phase === 'lobby' || phase === 'joining') {
    return <GuestLobby />;
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

// ─── Звонок ──────────────────────────────────────────────────────────────────

function GuestTile({
  name,
  stream,
  muted,
  isGuest,
  isLocal,
}: {
  name: string;
  stream: MediaStream | null;
  muted: boolean;
  isGuest: boolean;
  isLocal?: boolean;
}) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const hasVideo = Boolean(stream?.getVideoTracks().some((track) => track.enabled));

  return (
    <div className="guest-tile">
      <video ref={videoRef} autoPlay playsInline muted={isLocal} className={hasVideo ? undefined : 'is-hidden'} />
      {!hasVideo && <Avatar username={name} className="guest-tile-avatar" />}
      <div className="guest-tile-label">
        {muted && <MicOff size={12} strokeWidth={1.8} />}
        <span className="guest-tile-name">{name}</span>
        {isGuest && <span className="guest-tile-badge">{t('guest.guestBadge')}</span>}
        {isLocal && <span className="guest-tile-you">{t('guest.youBadge')}</span>}
      </div>
    </div>
  );
}

function GuestChat({ onClose }: { onClose: () => void }) {
  const t = useT();
  const messages = useGuestCallStore((s) => s.messages);
  const sendChat = useGuestCallStore((s) => s.sendChat);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    try {
      await sendChat(text);
      setError(null);
    } catch (err) {
      const apiErr = err as { code?: string; message?: string };
      setError({ code: apiErr.code, message: apiErr.message ?? '' });
    }
  };

  return (
    <aside className="guest-chat">
      <div className="guest-chat-head">
        <span>{t('guest.chat')}</span>
        <button type="button" className="btn btn-ghost guest-chat-close" onClick={onClose}>
          {t('guest.close')}
        </button>
      </div>
      <div className="guest-chat-list" ref={listRef}>
        {messages.map((message) => (
          <div key={message.id} className="guest-chat-message">
            <span className="guest-chat-author">
              {message.author.kind === 'guest' ? message.author.display_name : message.author.username}
              {message.author.kind === 'guest' && (
                <span className="guest-tile-badge">{t('guest.guestBadge')}</span>
              )}
            </span>
            <span className="guest-chat-text">{message.content}</span>
          </div>
        ))}
      </div>
      {error && <p className="guest-error">{guestErrorText(error, t)}</p>}
      <div className="guest-chat-composer">
        <input
          className="input"
          value={draft}
          placeholder={t('guest.chatPlaceholder')}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
          }}
        />
        <button type="button" className="btn btn-primary guest-chat-send" onClick={() => void send()}>
          <Send size={16} strokeWidth={1.8} />
        </button>
      </div>
      <p className="guest-chat-hint">{t('guest.chatHint')}</p>
    </aside>
  );
}

function GuestCall() {
  const t = useT();
  const phase = useGuestCallStore((s) => s.phase);
  const remotes = useGuestCallStore((s) => s.remotes);
  const participants = useGuestCallStore((s) => s.participants);
  const mutedPeers = useGuestCallStore((s) => s.mutedPeers);
  const localStream = useGuestCallStore((s) => s.localStream);
  const isMuted = useGuestCallStore((s) => s.isMuted);
  const isVideoOff = useGuestCallStore((s) => s.isVideoOff);
  const isMicAvailable = useGuestCallStore((s) => s.isMicAvailable);
  const displayName = useGuestCallStore((s) => s.displayName);
  const chatUnread = useGuestCallStore((s) => s.chatUnread);
  const toggleMute = useGuestCallStore((s) => s.toggleMute);
  const toggleVideo = useGuestCallStore((s) => s.toggleVideo);
  const leave = useGuestCallStore((s) => s.leave);
  const markChatRead = useGuestCallStore((s) => s.markChatRead);
  const [chatOpen, setChatOpen] = useState(false);

  const nameFor = useMemo(() => {
    const names = new Map<string, { name: string; isGuest: boolean }>();
    participants.users.forEach((user) => {
      names.set(user.user_id, { name: user.username ?? user.user_id.slice(0, 8), isGuest: false });
    });
    participants.guests.forEach((guest) => {
      names.set(guest.id, { name: guest.display_name, isGuest: true });
    });
    return names;
  }, [participants]);

  if (phase === 'connecting') {
    return (
      <div className="guest-page guest-page-stage">
        <div className="guest-status">
          <Loader2 size={28} strokeWidth={1.8} className="guest-spinner" />
          <span>{t('guest.connecting')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="guest-page guest-page-stage">
      <div className="guest-stage">
        <div className="guest-grid">
          <GuestTile name={displayName} stream={localStream} muted={isMuted} isGuest isLocal />
          {remotes.map((remote) => {
            const known = nameFor.get(remote.userId);
            return (
              <GuestTile
                key={remote.userId}
                name={known?.name ?? remote.userId.replace('guest:', '').slice(0, 8)}
                stream={remote.stream}
                muted={mutedPeers.has(remote.userId)}
                isGuest={known?.isGuest ?? remote.userId.startsWith('guest:')}
              />
            );
          })}
        </div>
        {chatOpen && <GuestChat onClose={() => setChatOpen(false)} />}
      </div>

      <div className="guest-controls">
        <button
          type="button"
          className={`guest-control${isMuted ? ' is-off' : ''}`}
          onClick={toggleMute}
          disabled={!isMicAvailable}
          title={isMuted ? t('guest.micOff') : t('guest.micOn')}
        >
          {isMuted ? <MicOff size={20} strokeWidth={1.8} /> : <Mic size={20} strokeWidth={1.8} />}
        </button>
        <button
          type="button"
          className={`guest-control${isVideoOff ? ' is-off' : ''}`}
          onClick={toggleVideo}
          title={isVideoOff ? t('guest.cameraOff') : t('guest.cameraOn')}
        >
          {isVideoOff ? <VideoOff size={20} strokeWidth={1.8} /> : <Video size={20} strokeWidth={1.8} />}
        </button>
        <button
          type="button"
          className={`guest-control${chatOpen ? ' is-active' : ''}`}
          onClick={() => {
            setChatOpen((open) => !open);
            markChatRead();
          }}
          title={t('guest.chat')}
        >
          <MessageSquare size={20} strokeWidth={1.8} />
          {chatUnread > 0 && !chatOpen && <span className="guest-control-badge">{chatUnread}</span>}
        </button>
        <span className="guest-control-count">
          <Users size={16} strokeWidth={1.8} />
          {participants.users.length + participants.guests.length}
        </span>
        <button
          type="button"
          className="guest-control guest-control-leave"
          onClick={() => void leave()}
          title={t('guest.leave')}
        >
          <PhoneOff size={20} strokeWidth={1.8} />
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

