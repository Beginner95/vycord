import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { useMessageStore } from '@/stores/messageStore';
import { groupCallService, SCREEN_QUALITY_PRESETS } from '@/services/groupCall';
import type { ScreenQuality, ScreenQualityPreset } from '@/services/groupCall';
import { wsService } from '@/services/websocket';
import { apiService } from '@/services/api';
import { audioService } from '@/services/audio';
import type { User, Message } from '@/types';
import type { DesktopCapturerSource } from '@/types/electron';
import type { ConnectionQualityMetrics, QualityLevel } from '@/utils/callQuality';
import { VolumeControlPopover } from './VolumeControlPopover';
import { useT, useTp, useDateFormat, type TKey } from '@/i18n';
import './GroupCallUI.css';

function useMicLevel(stream: MediaStream | null, isMuted: boolean): number {
  const [level, setLevel] = useState(0);
  const rafRef = useRef(0);
  // Tracked as an explicit dependency below because the SFU reuses and mutates
  // the same MediaStream object as a participant's tracks arrive (audio and
  // video ontrack fire separately, order not guaranteed) — the object
  // reference alone doesn't change when it gains an audio track later, so
  // recomputing this count on every render is what lets the effect re-run.
  const audioTrackCount = stream?.getAudioTracks().length ?? 0;

  useEffect(() => {
    // createMediaStreamSource throws InvalidStateError on a stream with no
    // audio track yet — wait until one is actually present.
    if (!stream || isMuted || audioTrackCount === 0) {
      setLevel(0);
      return;
    }

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setLevel(avg / 128);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      source.disconnect();
      ctx.close();
    };
  }, [stream, isMuted, audioTrackCount]);

  return level;
}

interface RemoteParticipant {
  userId: string;
  stream: MediaStream | null;
}

// Attaches a remote MediaStream to a video element and starts playback.
//
// Autoplay policy problem: when ontrack fires for an audio-only or audio-first
// stream (B's case — A's audio+video arrive in a single SFU offer, audio ontrack
// may fire before video), Chrome blocks el.play() with NotAllowedError because
// the user gesture from "join call" click is expired by the time ICE+DTLS finishes.
//
// Fix: play muted first (always allowed), then immediately unmute. Chrome cannot
// block unmuting a playing element — audio starts as soon as muted becomes false.
// This is the standard cross-browser workaround used by WebRTC apps.
function attachStreamToElement(el: HTMLVideoElement, stream: MediaStream, userId: string, volume: number): void {
  el.srcObject = stream;
  el.volume = volume;
  const audioTracks = stream.getAudioTracks();
  const videoTracks = stream.getVideoTracks();
  console.log(`[GC] attachStream uid=${userId.slice(0, 8)}`, {
    audioTracks: audioTracks.map((t) => ({ id: t.id.slice(0, 8), enabled: t.enabled, muted: t.muted, readyState: t.readyState })),
    videoTracks: videoTracks.map((t) => ({ id: t.id.slice(0, 8), enabled: t.enabled })),
    elMuted: el.muted,
    elVolume: el.volume,
    elPaused: el.paused,
    elReadyState: el.readyState,
  });

  // Mute temporarily so play() is guaranteed to succeed regardless of autoplay policy.
  el.muted = true;
  el.play()
    .then(() => {
      // Unmute immediately — browser cannot block this once the element is playing.
      el.muted = false;
      console.log(`[GC] attachStream: play+unmute succeeded uid=${userId.slice(0, 8)}`);
    })
    .catch((err) => {
      // Even muted play failed (e.g. element detached). Restore state.
      el.muted = false;
      console.warn(`[GC] el.play() failed uid=${userId.slice(0, 8)}:`, err);
    });
}

// ─── Screen Source Picker Modal ──────────────────────────────────────────────

interface ScreenSourcePickerProps {
  sources: DesktopCapturerSource[];
  onSelect: (sourceId: string) => void;
  onCancel: () => void;
}

function ScreenSourcePicker({ sources, onSelect, onCancel }: ScreenSourcePickerProps) {
  const t = useT();
  const screens = sources.filter((s) => s.id.startsWith('screen:'));
  const windows = sources.filter((s) => s.id.startsWith('window:'));

  return (
    <div className="screen-picker-backdrop" onClick={onCancel}>
      <div className="screen-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="screen-picker-header">
          <span>{t('call.selectScreen')}</span>
          <button className="screen-picker-close" onClick={onCancel}>✕</button>
        </div>

        {screens.length > 0 && (
          <div className="screen-picker-section">
            <div className="screen-picker-section-label">{t('call.entireScreen')}</div>
            <div className="screen-picker-grid">
              {screens.map((s) => (
                <button key={s.id} className="screen-picker-item" onClick={() => onSelect(s.id)}>
                  <img src={s.thumbnail} alt={s.name} className="screen-picker-thumb" />
                  <span className="screen-picker-name">{s.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {windows.length > 0 && (
          <div className="screen-picker-section">
            <div className="screen-picker-section-label">{t('call.applicationWindow')}</div>
            <div className="screen-picker-grid">
              {windows.map((s) => (
                <button key={s.id} className="screen-picker-item" onClick={() => onSelect(s.id)}>
                  {s.appIconUrl
                    ? <img src={s.appIconUrl} alt="" className="screen-picker-app-icon" />
                    : <img src={s.thumbnail} alt={s.name} className="screen-picker-thumb" />
                  }
                  <span className="screen-picker-name">{s.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Screen Quality Picker Modal ─────────────────────────────────────────────

interface ScreenQualityPickerProps {
  onSelect: (quality: ScreenQuality) => void;
  onCancel: () => void;
}

function ScreenQualityPicker({ onSelect, onCancel }: ScreenQualityPickerProps) {
  const t = useT();
  const entries = Object.entries(SCREEN_QUALITY_PRESETS) as [ScreenQuality, ScreenQualityPreset][];
  return (
    <div className="screen-picker-backdrop" onClick={onCancel}>
      <div className="screen-quality-modal" onClick={(e) => e.stopPropagation()}>
        <div className="screen-picker-header">
          <span>{t('call.selectQuality')}</span>
          <button className="screen-picker-close" onClick={onCancel}>✕</button>
        </div>
        <div className="screen-quality-list">
          {entries.map(([key, preset]) => (
            <button key={key} className="screen-quality-item" onClick={() => onSelect(key)}>
              <span className="screen-quality-label">{preset.label}</span>
              <span className="screen-quality-desc">
                {preset.width} × {preset.height} · {preset.frameRate} fps
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Connection Indicator ────────────────────────────────────────────────────
// Presentational signal-bars icon showing outbound (uplink) connection quality.

const QUALITY_KEY: Record<QualityLevel, TKey> = {
  good: 'call.qualityGood',
  medium: 'call.qualityMedium',
  poor: 'call.qualityPoor',
  unknown: 'call.qualityUnknown',
};

export function ConnectionIndicator({ metrics }: { metrics?: ConnectionQualityMetrics }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);

  const showTip = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Центрируем над индикатором; фиксированное позиционирование не режется
    // overflow:hidden плитки. Стрелка тултипа смотрит вниз, на индикатор.
    setTip({ top: r.top - 8, left: r.left + r.width / 2 });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);

  if (!metrics) return null;
  const { level, packetLoss, rtt, bitrate } = metrics;
  const label = t(QUALITY_KEY[level]);
  const ariaLabel =
    level === 'unknown'
      ? label
      : `${label} · ${t('call.qualityLoss')}: ${packetLoss}${t('call.unitPercent')} · ` +
        `${t('call.qualityPing')}: ${rtt} ${t('call.unitMs')} · ` +
        `${t('call.qualityBitrate')}: ${bitrate} ${t('call.unitKbps')}`;

  return (
    <div
      ref={ref}
      className={`conn-indicator conn-indicator--${level}`}
      aria-label={ariaLabel}
      onMouseEnter={showTip}
      onMouseLeave={hideTip}
    >
      <span className="conn-bar conn-bar--1" />
      <span className="conn-bar conn-bar--2" />
      <span className="conn-bar conn-bar--3" />
      {tip &&
        createPortal(
          <div
            className={`conn-tooltip conn-tooltip--${level}`}
            style={{ top: tip.top, left: tip.left }}
            role="tooltip"
          >
            <div className="conn-tooltip__head">
              <span className="conn-tooltip__dot" />
              <span className="conn-tooltip__title">{label}</span>
            </div>
            {level !== 'unknown' && (
              <div className="conn-tooltip__rows">
                <div className="conn-tooltip__row">
                  <span className="conn-tooltip__key">{t('call.qualityLoss')}</span>
                  <span className="conn-tooltip__val">{packetLoss}{t('call.unitPercent')}</span>
                </div>
                <div className="conn-tooltip__row">
                  <span className="conn-tooltip__key">{t('call.qualityPing')}</span>
                  <span className="conn-tooltip__val">{rtt} {t('call.unitMs')}</span>
                </div>
                <div className="conn-tooltip__row">
                  <span className="conn-tooltip__key">{t('call.qualityBitrate')}</span>
                  <span className="conn-tooltip__val">{bitrate} {t('call.unitKbps')}</span>
                </div>
              </div>
            )}
            <span className="conn-tooltip__arrow" />
          </div>,
          document.body,
        )}
    </div>
  );
}

// ─── Remote Participant Tile ─────────────────────────────────────────────────
// Wraps useMicLevel per participant — hooks can't run inside .map(), so each
// remote tile (grid or thumbnail) needs its own component instance.

interface RemoteParticipantTileProps {
  participant: RemoteParticipant;
  displayName: string;
  muted: boolean;
  isSharing: boolean;
  layout: 'grid' | 'thumbnail';
  isFocused?: boolean;
  onFocus: () => void;
  videoRefSetter: (el: HTMLVideoElement | null) => void;
  volume: number;
  isVolumePopoverOpen: boolean;
  onToggleVolumePopover: () => void;
  onCloseVolumePopover: () => void;
  onVolumeChange: (value: number) => void;
  quality?: ConnectionQualityMetrics;
}

function RemoteParticipantTile({
  participant,
  displayName,
  muted,
  isSharing,
  layout,
  isFocused,
  onFocus,
  videoRefSetter,
  volume,
  isVolumePopoverOpen,
  onToggleVolumePopover,
  onCloseVolumePopover,
  onVolumeChange,
  quality,
}: RemoteParticipantTileProps) {
  const t = useT();
  const level = useMicLevel(participant.stream, muted);
  const speaking = level > 0.05;
  const micBadgeClass = muted
    ? 'mic-badge--muted'
    : speaking
      ? 'mic-badge--speaking'
      : 'mic-badge--idle';

  const volumeBtnRef = useRef<HTMLButtonElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);

  const handleVolumeBtnClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = volumeBtnRef.current?.getBoundingClientRect();
    if (rect) setPopoverPosition({ top: rect.bottom + 6, left: rect.left });
    onToggleVolumePopover();
  };

  const showWatchOverlay = isSharing && !isFocused;

  if (layout === 'thumbnail') {
    return (
      <div
        className={`thumbnail-tile ${isFocused ? 'thumbnail-tile--focused' : ''} ${speaking ? 'speaking' : ''}`}
        onClick={onFocus}
        title={displayName}
      >
        <video ref={videoRefSetter} autoPlay playsInline style={showWatchOverlay ? { display: 'none' } : undefined} />
        {!participant.stream && !showWatchOverlay && <div className="thumbnail-placeholder">📷</div>}
        {showWatchOverlay && (
          <div className="watch-share-overlay">
            <span className="watch-share-icon">🖥</span>
            <button className="watch-share-btn" onClick={(e) => { e.stopPropagation(); onFocus(); }}>
              {t('call.watchShare')}
            </button>
          </div>
        )}
        {isSharing && <div className="thumbnail-badge">🖥</div>}
        <button
          ref={volumeBtnRef}
          className="volume-btn"
          onClick={handleVolumeBtnClick}
          onMouseDown={(e) => e.stopPropagation()}
          title={t('call.volumeLabel', { value: volume })}
        >
          ⋮
        </button>
        {isVolumePopoverOpen && popoverPosition && (
          <VolumeControlPopover
            value={volume}
            position={popoverPosition}
            onChange={onVolumeChange}
            onClose={onCloseVolumePopover}
          />
        )}
        <div className={`mic-badge ${micBadgeClass}`}>{muted ? '🔇' : '🎤'}</div>
        <ConnectionIndicator metrics={quality} />
        <div className="thumbnail-label">{displayName}</div>
      </div>
    );
  }

  return (
    <div className={`video-tile ${!participant.stream ? 'video-off' : ''} ${speaking ? 'speaking' : ''}`}>
      <video ref={videoRefSetter} autoPlay playsInline style={showWatchOverlay ? { display: 'none' } : undefined} />
      {!participant.stream && !showWatchOverlay && <div className="video-off-placeholder">📷</div>}
      {showWatchOverlay && (
        <div className="watch-share-overlay">
          <span className="watch-share-icon">🖥</span>
          <button className="watch-share-btn" onClick={(e) => { e.stopPropagation(); onFocus(); }}>
            {t('call.watchShare')}
          </button>
        </div>
      )}
      {isSharing && <div className="screen-share-badge">🖥 {t('call.sharingBadge')}</div>}
      <button className="focus-btn" onClick={onFocus} title={t('call.focusParticipant')}>⛶</button>
      <button
        ref={volumeBtnRef}
        className="volume-btn"
        onClick={handleVolumeBtnClick}
        onMouseDown={(e) => e.stopPropagation()}
        title={t('call.volumeLabel', { value: volume })}
      >
        ⋮
      </button>
      {isVolumePopoverOpen && popoverPosition && (
        <VolumeControlPopover
          value={volume}
          position={popoverPosition}
          onChange={onVolumeChange}
          onClose={onCloseVolumePopover}
        />
      )}
      <div className={`mic-badge ${micBadgeClass}`}>{muted ? '🔇' : '🎤'}</div>
      <ConnectionIndicator metrics={quality} />
      <div className="video-label">{displayName}</div>
    </div>
  );
}

export function GroupCallUI() {
  const t = useT();
  const tp = useTp();
  const { formatTime } = useDateFormat();
  const { user } = useAuthStore();
  const { currentServer, currentChannel } = useServerStore();
  const { messages, addMessage } = useMessageStore();
  const [isInGroupCall, setIsInGroupCall] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isMicAvailable, setIsMicAvailable] = useState(true);
  const [isVideoOff, setIsVideoOff] = useState(true);
  const [showChat, setShowChat] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const [userCache, setUserCache] = useState<Map<string, string>>(new Map());
  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [screenSources, setScreenSources] = useState<DesktopCapturerSource[]>([]);
  const [showQualityPicker, setShowQualityPicker] = useState(false);
  // null = non-Electron path (getDisplayMedia will pick its own source)
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  // Set of remote user IDs currently sharing their screen
  const [screenSharers, setScreenSharers] = useState<Set<string>>(new Set());
  // Controls ONLY the "someone is sharing" banner's visibility. It must never be
  // conflated with screenSharers: clearing that set removes the Watch overlay
  // from every sharing tile and empties the focused view, with no way back until
  // the sharer restarts. Reset whenever a new share starts (below).
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // userId -> their screen-share MediaStream (video + audio), populated only
  // while we're actively watching them (see onRemoteScreenStream below).
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Map<string, MediaStream>>(new Map());
  // When set, shows the focused layout (large video + thumbnails strip)
  const [focusedUserId, setFocusedUserId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const focusedVideoRef = useRef<HTMLVideoElement>(null);
  const screenShareMainRef = useRef<HTMLDivElement>(null);
  // Stable ref to participants for use in WS event callbacks (avoids stale closure)
  const participantsRef = useRef<RemoteParticipant[]>([]);
  // Tracks which remote user's screen share (if any) we're currently subscribed
  // to via watchShare/unwatchShare. Declared here (rather than beside the sync
  // effect below) so onReconnected — set up inside the earlier groupCallService.init
  // useEffect — can also read/write it without a stale closure.
  const prevWatchedRef = useRef<string | null>(null);
  // Snapshot of prevWatchedRef.current taken at the start of onReconnecting,
  // before setFocusedUserId(null) triggers the sync effect below and clobbers
  // prevWatchedRef.current back to null. onReconnected reads this (not
  // prevWatchedRef) to decide whether to resubscribe after the outage.
  const watchedBeforeReconnectRef = useRef<string | null>(null);

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  const [remoteMicMuted, setRemoteMicMuted] = useState<Map<string, boolean>>(new Map());

  // Stable ref to isMuted for use in the onPeerJoined WS callback (avoids stale closure)
  const isMutedRef = useRef(isMuted);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // userId -> 0-100, local-only, never persisted or sent over WS; missing entry means 100 (default)
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>({});
  const [volumePopoverUserId, setVolumePopoverUserId] = useState<string | null>(null);

  // Stable ref to participantVolumes for use in the onRemoteStream WS callback (avoids stale closure)
  const participantVolumesRef = useRef<Record<string, number>>({});

  useEffect(() => {
    participantVolumesRef.current = participantVolumes;
  }, [participantVolumes]);

  // userId -> latest connection-quality metrics received via WS broadcasts.
  const [qualityByUser, setQualityByUser] = useState<Record<string, ConnectionQualityMetrics>>({});
  // Local outbound (uplink) quality, sampled by groupCallService and reported via onLocalQuality.
  const [localQuality, setLocalQuality] = useState<ConnectionQualityMetrics | undefined>(undefined);

  // Throttling state for outgoing connection_quality sends: resend on level
  // change, or as a heartbeat at least every 9s.
  const qualitySendRef = useRef<{ lastLevel: QualityLevel | null; lastSentAt: number }>({
    lastLevel: null,
    lastSentAt: 0,
  });

  useEffect(() => {
    groupCallService.init({
      onRemoteStream: (userId, stream) => {
        setParticipants((prev) => {
          const exists = prev.find((p) => p.userId === userId);
          if (exists) {
            return prev.map((p) =>
              p.userId === userId ? { ...p, stream } : p
            );
          }
          return [...prev, { userId, stream }];
        });

        // Attach stream to video element if it's already in the DOM.
        // The useEffect below is the fallback for when React re-renders first.
        const videoEl = remoteVideoRefs.current.get(userId);
        if (videoEl && videoEl.srcObject !== stream) {
          attachStreamToElement(videoEl, stream, userId, (participantVolumesRef.current[userId] ?? 100) / 100);
        }
      },
      onRemoteScreenStream: (userId, stream) => {
        setRemoteScreenStreams((prev) => {
          const next = new Map(prev);
          next.set(userId, stream);
          return next;
        });
      },
      onPeerJoined: (userId, source) => {
        setParticipants((prev) => {
          if (prev.find((p) => p.userId === userId)) return prev;
          return [...prev, { userId, stream: null }];
        });
        // Only a live arrival is an actual join: 'snapshot' peers were already in the
        // room when we connected, which also happens on every auto-reconnect and must
        // stay silent.
        if (source === 'live') audioService.playUserJoined();
        // Fires both when I discover an already-present peer and when someone
        // joins after me — re-announcing my mic state either way is harmless
        // and closes the window where a newly-joined peer doesn't know it yet.
        wsService.send(isMutedRef.current ? 'mic_muted' : 'mic_unmuted', {});
      },
      onPeerLeft: (userId) => {
        // A genuinely live participant_left for someone else's userId always means a real
        // departure. It can also fire with OUR OWN userId when the server evicts a stale
        // session of ours (second-device login, or a reconnect landing inside
        // disconnectedTimeout) — groupCall.ts's handleMessage filters that case out before
        // calling onPeerLeft, so by the time we get here it is always a real departure.
        audioService.playUserLeft();
        setParticipants((prev) => prev.filter((p) => p.userId !== userId));
        setRemoteScreenStreams((prev) => {
          const next = new Map(prev);
          next.delete(userId);
          return next;
        });
        setRemoteMicMuted((prev) => {
          const next = new Map(prev);
          next.delete(userId);
          return next;
        });
        setQualityByUser((prev) => {
          const next = { ...prev };
          delete next[userId];
          return next;
        });
      },
      onReconnecting: () => {
        // Snapshot what we were watching BEFORE clearing focusedUserId below —
        // that state update triggers the watch/unwatch sync effect, which would
        // otherwise clobber prevWatchedRef.current back to null before
        // onReconnected ever gets a chance to read it.
        //
        // Plain assignment (no `?? ` fallback): onReconnected below now restores
        // real focusedUserId/screenSharers state instead of bookkeeping a second
        // ref, so the sync effect reconciles prevWatchedRef with reality after
        // every reconnect cycle. prevWatchedRef is therefore always current by
        // the time the next onReconnecting runs, and a fallback here would only
        // reintroduce the staleness this design removes (e.g. incorrectly
        // resubscribing after a real, explicit unfocus).
        watchedBeforeReconnectRef.current = prevWatchedRef.current;
        setIsReconnecting(true);
        // Participants are re-announced via 'joined'/onPeerJoined after
        // rejoin; clear now so users who left during the outage don't linger.
        setParticipants([]);
        setRemoteScreenStreams(new Map());
        setScreenSharers(new Set());
        setBannerDismissed(false);
        setRemoteMicMuted(new Map());
        setParticipantVolumes({});
        setVolumePopoverUserId(null);
        setFocusedUserId(null);
        setQualityByUser({});
        setLocalQuality(undefined);
      },
      onReconnected: () => {
        setIsReconnecting(false);
        // Restore real focus/watch state (rather than calling watchShare directly
        // and tracking it in a second ref) so the sync effect below — the single
        // place that sends watch_share/unwatch_share — naturally reconciles
        // prevWatchedRef with reality on its next run, exactly like any other
        // focus transition. This keeps one source of truth instead of two refs
        // that can drift apart across reconnect cycles.
        const target = watchedBeforeReconnectRef.current;
        if (target) {
          setScreenSharers((prev) => new Set(prev).add(target));
          setFocusedUserId(target);
        }
      },
      onSharingPeers: (ids) => {
        // Authoritative "who is sharing right now" snapshot from the SFU's
        // 'joined' notification (initial join AND reconnects). Union with what we
        // already know — a reconnect's onReconnected may have just restored a
        // watched user, and onSharingPeers must not erase that. This is what fixes
        // the Watch button never appearing for a viewer who joins (or reconnects)
        // while a share is already active: the app-WS screen_share_started
        // broadcast is fire-and-forget and late joiners miss it.
        setScreenSharers((prev) => {
          const next = new Set(prev);
          for (const uid of ids) next.add(uid);
          return next;
        });
      },
      onCallEnded: () => {
        const channelId = groupCallService.currentRoomIdState;
        if (channelId) wsService.send('voice_left', { channel_id: channelId });
        setIsReconnecting(false);
        setIsInGroupCall(false);
        setParticipants([]);
        setRemoteScreenStreams(new Map());
        setLocalQuality(undefined);
        setIsMuted(false);
        setIsMicAvailable(true);
        setIsVideoOff(false);
        setIsScreenSharing(false);
        setShowSourcePicker(false);
        setScreenSharers(new Set());
        setBannerDismissed(false);
        setRemoteMicMuted(new Map());
        setParticipantVolumes({});
        setVolumePopoverUserId(null);
        setFocusedUserId(null);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      },
      onError: (msg) => {
        const channelId = groupCallService.currentRoomIdState;
        if (channelId) wsService.send('voice_left', { channel_id: channelId });
        setIsReconnecting(false);
        console.error('[GroupCall] Error:', msg);
        setIsInGroupCall(false);
        setParticipants([]);
        setRemoteScreenStreams(new Map());
        setIsMicAvailable(true);
        setScreenSharers(new Set());
        setBannerDismissed(false);
        setRemoteMicMuted(new Map());
        setParticipantVolumes({});
        setVolumePopoverUserId(null);
        setFocusedUserId(null);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        groupCallService.leaveGroupCall();
      },
      onScreenShareEnded: () => {
        setIsScreenSharing(false);
        wsService.send('screen_share_stopped', {});
      },
      onScreenShareRestored: () => {
        // Our reconnect made everyone else drop us from their screenSharers set
        // (their own onReconnecting/participant_left cleanup, or simply never
        // having seen the original broadcast). Re-announce so their Watch
        // overlay/banner comes back for the share that is still running.
        wsService.send('screen_share_started', {});
      },
      onLocalQuality: (metrics) => {
        setLocalQuality(metrics);
        const now = Date.now();
        const st = qualitySendRef.current;
        const changed = metrics.level !== st.lastLevel;
        const heartbeat = now - st.lastSentAt >= 9000;
        if (changed || heartbeat) {
          st.lastLevel = metrics.level;
          st.lastSentAt = now;
          wsService.send('connection_quality', {
            level: metrics.level,
            packet_loss: metrics.packetLoss,
            rtt: metrics.rtt,
            bitrate: metrics.bitrate,
          });
        }
      },
    });
  }, []);

  useEffect(() => {
    if (!localVideoRef.current) return;
    const stream = isScreenSharing
      ? groupCallService.screenStreamState
      : groupCallService.localStreamState;
    if (stream) localVideoRef.current.srcObject = stream;
  }, [isInGroupCall, isScreenSharing, focusedUserId]);

  // Attach remote streams after React commits the video elements to DOM.
  // This is the primary attachment path — by the time this effect runs,
  // ref callbacks have already fired so remoteVideoRefs is populated.
  // Also depends on focusedUserId so streams re-attach after view switches (grid ↔ focused).
  useEffect(() => {
    participants.forEach((p) => {
      const videoEl = remoteVideoRefs.current.get(p.userId);
      console.log(`[GC] participants effect uid=${p.userId.slice(0, 8)}`, {
        hasStream: !!p.stream,
        hasVideoEl: !!videoEl,
        srcObjectMatch: videoEl ? videoEl.srcObject === p.stream : null,
        elMuted: videoEl?.muted ?? null,
        elPaused: videoEl?.paused ?? null,
        elReadyState: videoEl?.readyState ?? null,
      });
      if (p.stream) {
        if (videoEl && videoEl.srcObject !== p.stream) {
          attachStreamToElement(videoEl, p.stream, p.userId, (participantVolumes[p.userId] ?? 100) / 100);
        }
      }
    });
  }, [participants, focusedUserId]);

  // Track fullscreen state changes (ESC key or programmatic exit)
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Listen for remote screen share events via main WS
  useEffect(() => {
    if (!isInGroupCall) return;

    const unsubStart = wsService.on('screen_share_started', (payload) => {
      const p = payload as { user_id: string };
      if (p.user_id === user?.id) return; // ignore own events
      // Only care about current call participants
      if (!participantsRef.current.some((pt) => pt.userId === p.user_id)) return;
      // A dismissed banner must not stay dismissed for a later, different share.
      setBannerDismissed(false);
      setScreenSharers((prev) => new Set([...prev, p.user_id]));
    });

    const unsubStop = wsService.on('screen_share_stopped', (payload) => {
      const p = payload as { user_id: string };
      setScreenSharers((prev) => {
        const next = new Set(prev);
        next.delete(p.user_id);
        return next;
      });
      setRemoteScreenStreams((prev) => {
        const next = new Map(prev);
        next.delete(p.user_id);
        return next;
      });
      groupCallService.unwatchShare(p.user_id);
      // If this participant was focused, exit focus view and fullscreen
      setFocusedUserId((prev) => {
        if (prev === p.user_id) {
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          return null;
        }
        return prev;
      });
    });

    const unsubMicMuted = wsService.on('mic_muted', (payload) => {
      const p = payload as { user_id: string };
      if (p.user_id === user?.id) return;
      if (!participantsRef.current.some((pt) => pt.userId === p.user_id)) return;
      setRemoteMicMuted((prev) => new Map(prev).set(p.user_id, true));
    });

    const unsubMicUnmuted = wsService.on('mic_unmuted', (payload) => {
      const p = payload as { user_id: string };
      if (p.user_id === user?.id) return;
      if (!participantsRef.current.some((pt) => pt.userId === p.user_id)) return;
      setRemoteMicMuted((prev) => new Map(prev).set(p.user_id, false));
    });

    const unsubQuality = wsService.on('connection_quality', (payload) => {
      const p = payload as { user_id: string; level: QualityLevel; packet_loss: number; rtt: number; bitrate: number };
      if (p.user_id === user?.id) return; // своё качество берём из локального сэмплера
      if (!participantsRef.current.some((pt) => pt.userId === p.user_id)) return;
      setQualityByUser((prev) => ({
        ...prev,
        [p.user_id]: { level: p.level, packetLoss: p.packet_loss, rtt: p.rtt, bitrate: p.bitrate },
      }));
    });

    return () => { unsubStart(); unsubStop(); unsubMicMuted(); unsubMicUnmuted(); unsubQuality(); };
  }, [isInGroupCall, user?.id]);

  // Attach stream to the focused main video whenever focus or stream changes.
  // Two cases: focusing a screen-sharer plays their dedicated screen stream
  // (video AND audio — this is now the only place screen-share audio plays);
  // focusing anyone else keeps the old behavior (camera/mic stream, muted here
  // because audio for regular participants plays via their thumbnail element).
  useEffect(() => {
    const el = focusedVideoRef.current;
    if (!el || !focusedUserId) return;
    // Prefer the dedicated screen-share stream whenever one is present for the
    // focused user — regardless of the screenSharers set. screenSharers is fed by
    // a separate app-WS broadcast and can lag/desync (or a late-join broadcast can
    // be missed), so requiring it here too could wrongly fall through to the
    // sharer's webcam even though the screen stream already arrived.
    const screenStream = remoteScreenStreams.get(focusedUserId);
    console.log(`[GC] focused effect uid=${focusedUserId.slice(0, 8)}`, {
      hasScreenStream: !!screenStream,
      screenStreamTracks: screenStream ? screenStream.getTracks().map((t) => `${t.kind}:${t.id.slice(0, 8)}:enabled=${t.enabled}`) : [],
      isScreenSharer: screenSharers.has(focusedUserId),
      srcObjectMatch: el.srcObject === screenStream,
      elMuted: el.muted,
      elPaused: el.paused,
      elReadyState: el.readyState,
    });
    if (screenStream) {
      if (el.srcObject !== screenStream) {
        el.srcObject = screenStream;
        // Autoplay-policy workaround, mirroring attachStreamToElement: this is the
        // first (and only) time the screen stream ever plays — it never sits on a
        // thumbnail, whose earlier attachStreamToElement play would have unlocked
        // autoplay for it. By the time focus-click → watch_share → renegotiation →
        // ontrack completes, the "Смотреть" user activation has usually expired, so
        // an unmuted el.play() here gets rejected → element stays paused → black
        // screen. Play muted (always allowed), then unmute — allowing playback of a
        // playing element cannot be blocked, and this is how screen audio starts.
        el.muted = true;
        el.play()
          .then(() => {
            el.muted = false;
          })
          .catch(() => {
            el.muted = false;
          });
      }
      return;
    }
    if (screenSharers.has(focusedUserId)) {
      // Known sharer whose stream hasn't arrived yet — keep muted and wait (the
      // retry effect below keeps watch_share alive). Never fall back to the
      // webcam here, otherwise the viewer sees the sharer's camera with no
      // share video/audio.
      el.muted = true;
      return;
    }
    const participant = participants.find((pt) => pt.userId === focusedUserId);
    if (participant?.stream && el.srcObject !== participant.stream) {
      el.srcObject = participant.stream;
      el.muted = true; // audio comes from the thumbnail element for camera focus
      el.play().catch(() => {});
    } else if (!participant?.stream) {
      el.muted = true;
    }
  }, [focusedUserId, participants, screenSharers, remoteScreenStreams]);

  // Keep the SFU subscription in sync with which screen share (if any) is
  // currently focused. Only one share can be watched at a time — switching
  // focus unwatches the previous target and watches the new one.
  useEffect(() => {
    const nextWatched = focusedUserId && screenSharers.has(focusedUserId) ? focusedUserId : null;
    const prevWatched = prevWatchedRef.current;
    if (prevWatched === nextWatched) return;
    if (prevWatched) groupCallService.unwatchShare(prevWatched);
    if (nextWatched) groupCallService.watchShare(nextWatched);
    prevWatchedRef.current = nextWatched;
  }, [focusedUserId, screenSharers]);

  // Self-heal the watch subscription for a focused sharer whose screen stream
  // hasn't arrived yet. The SFU forwards existing screen tracks at watch_share
  // time only if the publisher's sharing flag AND screen tracks are already
  // registered; if watch_share landed in the pre-registration window the SFU
  // delivered nothing. Retrying is idempotent on the server (a duplicate
  // watch_share for a registered watcher is a no-op), so we safely bridge that
  // window until the focused screen stream shows up. Stops once the stream lands
  // or the sharer is no longer in screenSharers.
  useEffect(() => {
    if (!focusedUserId) return;
    if (!screenSharers.has(focusedUserId)) return;
    if (remoteScreenStreams.has(focusedUserId)) return;
    const timer = setInterval(() => {
      if (!screenSharers.has(focusedUserId)) {
        clearInterval(timer);
        return;
      }
      if (remoteScreenStreams.get(focusedUserId)) {
        clearInterval(timer);
        return;
      }
      groupCallService.watchShare(focusedUserId);
    }, 800);
    return () => clearInterval(timer);
  }, [focusedUserId, screenSharers, remoteScreenStreams]);

  // Clear focus when focused participant leaves the call
  useEffect(() => {
    if (!focusedUserId) return;
    const stillPresent = participants.some((p) => p.userId === focusedUserId);
    if (!stillPresent) {
      setFocusedUserId(null);
      setScreenSharers((prev) => {
        const next = new Set(prev);
        next.delete(focusedUserId);
        return next;
      });
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  }, [participants, focusedUserId]);

  const handleFullscreen = useCallback(async () => {
    const container = screenShareMainRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    } else {
      await container.requestFullscreen().catch(() => {});
    }
  }, []);

  const handleJoinGroupCall = useCallback(async (roomId: string): Promise<boolean> => {
    if (!user) return false;
    if (groupCallService.isInGroupCallState && groupCallService.currentRoomIdState === roomId) {
      // Already actively in this exact call (e.g. re-clicking the active voice
      // channel, or your own row in the participant list) — no-op. Without this,
      // groupCallService.joinGroupCall's "already in a call" guard fires
      // onError, whose handler in this file reads currentRoomIdState, sends a
      // spurious voice_left, and tears down the still-active call.
      return false;
    }
    // joinGroupCall's "already in a call" guard is a no-op when re-invoked for
    // the room we're already in (e.g. re-clicking the active voice channel) —
    // it doesn't touch currentRoomId either, so capture the prior value here
    // to avoid a spurious duplicate voice_joined on that path.
    //
    // The guard above handles the case where we're actively in this room.
    // This check still matters for a narrower window: mid-reconnect, inCall
    // is briefly false (see partialTeardown) while currentRoomId is
    // deliberately left set to the room being reconnected to (reconnect()
    // reads it to rejoin the SAME room). A re-invocation during that window
    // skips the guard above (isInGroupCallState is false) but must still
    // suppress the duplicate voice_joined once joinGroupCall's own call
    // completes and lands back on the same room.
    const alreadyInThisRoom = groupCallService.currentRoomIdState === roomId;
    const isFirst = await groupCallService.joinGroupCall(roomId, user.id);
    if (!alreadyInThisRoom && groupCallService.currentRoomIdState === roomId) {
      wsService.send('voice_joined', { channel_id: roomId });
      // Same predicate as voice_joined: it filters out a repeated click on the active
      // voice channel and the mid-reconnect window where inCall is briefly false.
      audioService.playUserJoined();
    }
    setIsInGroupCall(true);
    const micAvailable = groupCallService.isMicrophoneAvailable;
    setIsMicAvailable(micAvailable);
    if (!micAvailable) setIsMuted(true);
    wsService.send(micAvailable ? 'mic_unmuted' : 'mic_muted', {});
    return isFirst;
  }, [user]);

  const handleLeaveGroupCall = useCallback(() => {
    const channelId = groupCallService.currentRoomIdState;
    if (groupCallService.isScreenSharing) {
      wsService.send('screen_share_stopped', {});
    }
    if (channelId) {
      wsService.send('voice_call_cancel', {
        channel_id: channelId,
        server_id: currentServer?.id,
      });
      wsService.send('voice_left', { channel_id: channelId });
      // Only the deliberate exit chimes. A dropped connection, session_replaced or an
      // exhausted reconnect all land in onCallEnded/onError instead and stay silent —
      // those are connection failures, not someone leaving the call.
      audioService.playUserLeft();
    }
    groupCallService.leaveGroupCall();
    setIsInGroupCall(false);
    setIsReconnecting(false);
    setParticipants([]);
    setIsScreenSharing(false);
    setShowSourcePicker(false);
    setScreenSharers(new Set());
    setFocusedUserId(null);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, [currentServer]);

  const handleVolumeChange = useCallback((userId: string, value: number) => {
    setParticipantVolumes((prev) => ({ ...prev, [userId]: value }));
    const videoEl = remoteVideoRefs.current.get(userId);
    if (videoEl) videoEl.volume = value / 100;
  }, []);

  const micLevel = useMicLevel(
    isInGroupCall ? groupCallService.localStreamState : null,
    isMuted,
  );

  const handleToggleMute = useCallback(() => {
    const muted = groupCallService.toggleMuteAudio();
    setIsMuted(muted);
    wsService.send(muted ? 'mic_muted' : 'mic_unmuted', {});
  }, []);

  const handleToggleVideo = useCallback(() => {
    const off = groupCallService.toggleMuteVideo();
    setIsVideoOff(off);
  }, []);

  const handleToggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      await groupCallService.stopScreenShare();
      setIsScreenSharing(false);
      wsService.send('screen_share_stopped', {});
      return;
    }

    const api = (window as Window & typeof globalThis).electronAPI;

    if (api?.getScreenSources) {
      // Electron: fetch sources → source picker → quality picker → start
      const result = await api.getScreenSources();
      if (result.error === 'screen_permission_denied') {
        alert(t('call.screenPermissionDenied'));
        return;
      }
      if (result.error || !result.sources?.length) {
        alert(t('call.screenSourcesFailed'));
        return;
      }
      setScreenSources(result.sources);
      setShowSourcePicker(true);
    } else {
      // Non-Electron: quality picker first, then getDisplayMedia (OS native picker opens when quality is confirmed)
      setSelectedSourceId(null);
      setShowQualityPicker(true);
    }
  }, [isScreenSharing, t]);

  const handleSelectSource = useCallback((sourceId: string) => {
    setShowSourcePicker(false);
    setSelectedSourceId(sourceId);
    setShowQualityPicker(true);
  }, []);

  const handleSelectQuality = useCallback(async (quality: ScreenQuality) => {
    setShowQualityPicker(false);
    const sourceId = selectedSourceId ?? undefined;
    setSelectedSourceId(null);
    try {
      await groupCallService.startScreenShare(sourceId, quality);
      setIsScreenSharing(true);
      wsService.send('screen_share_started', {});
    } catch (err) {
      console.error('[GroupCall] Screen share failed:', err);
      alert(t('call.screenShareFailed'));
    }
  }, [selectedSourceId, t]);

  // Expose joinGroupCall to window for other components
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.joinGroupCall = handleJoinGroupCall;
    w.leaveGroupCall = handleLeaveGroupCall;
  }, [handleJoinGroupCall, handleLeaveGroupCall]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const fetchUsernames = async () => {
      const userIds = new Set<string>();
      for (const msg of messages) {
        if (msg.user_id !== user?.id && !userCache.has(msg.user_id)) {
          userIds.add(msg.user_id);
        }
      }
      for (const p of participants) {
        if (p.userId !== user?.id && !userCache.has(p.userId)) {
          userIds.add(p.userId);
        }
      }
      for (const uid of userIds) {
        try {
          const fetched = await apiService.getUserById(uid) as User;
          setUserCache((prev) => new Map(prev).set(fetched.id, fetched.username));
        } catch {
          setUserCache((prev) => new Map(prev).set(uid, uid.slice(0, 8)));
        }
      }
    };
    if (messages.length > 0 || participants.length > 0) fetchUsernames();
  }, [messages, participants, user, userCache]);

  const handleSendMessage = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (!currentChannel || !chatInput.trim() || !user) return;
    try {
      const msg = await apiService.createMessage(currentChannel.id, chatInput.trim()) as Message;
      addMessage(msg);
      setChatInput('');
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  }, [currentChannel, chatInput, user, addMessage]);

  if (!isInGroupCall) return null;

  const showSourcePickerModal = showSourcePicker && screenSources.length > 0;

  const totalParticipants = participants.length + 1;
  const cols = Math.min(totalParticipants, 4);

  // Displayed name for the focused participant
  const focusedName = focusedUserId
    ? (userCache.get(focusedUserId) ?? focusedUserId.slice(0, 8))
    : '';
  // First screen sharer ID for the banner
  const firstSharer = screenSharers.size > 0 ? [...screenSharers][0] : null;

  return (
    <div className="group-call-overlay">
      {isReconnecting && (
        <div className="gc-reconnecting-banner">{t('call.reconnecting')}</div>
      )}
      {showSourcePickerModal && (
        <ScreenSourcePicker
          sources={screenSources}
          onSelect={handleSelectSource}
          onCancel={() => setShowSourcePicker(false)}
        />
      )}
      {showQualityPicker && (
        <ScreenQualityPicker
          onSelect={handleSelectQuality}
          onCancel={() => { setShowQualityPicker(false); setSelectedSourceId(null); }}
        />
      )}
      <div className="group-call-header">
        <h2>{t('call.groupCallTitle')}{currentChannel ? ` · #${currentChannel.name}` : ''}</h2>
        <div className="group-call-header-right">
          {screenSharers.size > 0 && (
            <span className="header-screen-share-indicator">🖥 {t('call.screenSharingActive')}</span>
          )}
          <span className="participant-count">{tp('call.participants', totalParticipants)}</span>
        </div>
      </div>

      <div className="call-body">
        <div className="call-video-area">
          {/* Banner: shown when someone is sharing but user hasn't opened focus view */}
          {firstSharer && !focusedUserId && !bannerDismissed && (
            <div className="screen-share-banner">
              <span className="screen-share-banner-icon">🖥</span>
              <span className="screen-share-banner-text">
                {t('call.isSharingScreen', { name: userCache.get(firstSharer) ?? firstSharer.slice(0, 8) })}
              </span>
              <button
                className="screen-share-banner-btn"
                onClick={() => setFocusedUserId(firstSharer)}
              >
                {t('call.view')}
              </button>
              <button
                className="screen-share-banner-dismiss"
                onClick={() => setBannerDismissed(true)}
                title={t('call.dismiss')}
              >
                ✕
              </button>
            </div>
          )}

          {focusedUserId ? (
            /* ── Focused / screen-share view ── */
            <div className="screen-share-view">
              <div className="screen-share-main" ref={screenShareMainRef}>
                <video
                  ref={focusedVideoRef}
                  autoPlay
                  playsInline
                  className="screen-share-main-video"
                />
                <div className="screen-share-main-label">
                  {focusedName}
                  {screenSharers.has(focusedUserId) && (
                    <span className="screen-share-badge-sm">🖥 {t('call.sharingBadge')}</span>
                  )}
                </div>
                <div className="screen-share-main-controls">
                  <button
                    className="screen-share-ctrl-btn"
                    onClick={() => { void handleFullscreen(); }}
                    title={isFullscreen ? t('call.exitFullscreen') : t('call.fullscreen')}
                  >
                    {isFullscreen ? '⊡' : '⛶'}
                  </button>
                  <button
                    className="screen-share-ctrl-btn"
                    onClick={() => setFocusedUserId(null)}
                    title={t('call.backToGrid')}
                  >
                    ⊞
                  </button>
                </div>
              </div>

              {/* Thumbnail strip */}
              <div className="screen-share-thumbnails">
                {/* Local thumbnail */}
                <div
                  className={`thumbnail-tile ${micLevel > 0.05 ? 'speaking' : ''}`}
                  title={`${user?.username ?? ''} ${t('call.youSuffix')}`}
                >
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={isScreenSharing ? 'local-video-screen' : 'local-video'}
                  />
                  {isVideoOff && !isScreenSharing && (
                    <div className="thumbnail-placeholder">📷</div>
                  )}
                  {isScreenSharing && <div className="thumbnail-badge">🖥</div>}
                  <div className={`mic-badge ${isMuted ? 'mic-badge--muted' : micLevel > 0.05 ? 'mic-badge--speaking' : 'mic-badge--idle'}`}>
                    {isMuted ? '🔇' : '🎤'}
                  </div>
                  <ConnectionIndicator metrics={localQuality} />
                  <div className="thumbnail-label">
                    {user?.username} {t('call.youSuffix')}
                  </div>
                </div>

                {/* Remote thumbnails */}
                {participants.map((p) => (
                  <RemoteParticipantTile
                    key={p.userId}
                    participant={p}
                    displayName={userCache.get(p.userId) ?? p.userId.slice(0, 8)}
                    muted={remoteMicMuted.get(p.userId) ?? false}
                    isSharing={screenSharers.has(p.userId)}
                    layout="thumbnail"
                    isFocused={focusedUserId === p.userId}
                    onFocus={() => setFocusedUserId(p.userId)}
                    videoRefSetter={(el) => { if (el) remoteVideoRefs.current.set(p.userId, el); }}
                    volume={participantVolumes[p.userId] ?? 100}
                    isVolumePopoverOpen={volumePopoverUserId === p.userId}
                    onToggleVolumePopover={() => setVolumePopoverUserId((prev) => (prev === p.userId ? null : p.userId))}
                    onCloseVolumePopover={() => setVolumePopoverUserId(null)}
                    onVolumeChange={(value) => handleVolumeChange(p.userId, value)}
                    quality={qualityByUser[p.userId]}
                  />
                ))}
              </div>
            </div>
          ) : (
            /* ── Normal video grid ── */
            <div className="video-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
              {/* Local video */}
              <div className={`video-tile ${isVideoOff && !isScreenSharing ? 'video-off' : ''} ${micLevel > 0.05 ? 'speaking' : ''}`}>
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={isScreenSharing ? 'local-video-screen' : 'local-video'}
                />
                {isVideoOff && !isScreenSharing && <div className="video-off-placeholder">📷</div>}
                {isScreenSharing && <div className="screen-share-badge">🖥 {t('call.sharingBadge')}</div>}
                <div className={`mic-badge ${isMuted ? 'mic-badge--muted' : micLevel > 0.05 ? 'mic-badge--speaking' : 'mic-badge--idle'}`}>
                  {isMuted ? '🔇' : '🎤'}
                </div>
                <ConnectionIndicator metrics={localQuality} />
                <div className="video-label">
                  {user?.username} {t('call.youSuffix')}
                </div>
              </div>

              {/* Remote videos */}
              {participants.map((p) => (
                <RemoteParticipantTile
                  key={p.userId}
                  participant={p}
                  displayName={userCache.get(p.userId) ?? p.userId.slice(0, 8)}
                  muted={remoteMicMuted.get(p.userId) ?? false}
                  isSharing={screenSharers.has(p.userId)}
                  layout="grid"
                  onFocus={() => setFocusedUserId(p.userId)}
                  videoRefSetter={(el) => { if (el) remoteVideoRefs.current.set(p.userId, el); }}
                  volume={participantVolumes[p.userId] ?? 100}
                  isVolumePopoverOpen={volumePopoverUserId === p.userId}
                  onToggleVolumePopover={() => setVolumePopoverUserId((prev) => (prev === p.userId ? null : p.userId))}
                  onCloseVolumePopover={() => setVolumePopoverUserId(null)}
                  onVolumeChange={(value) => handleVolumeChange(p.userId, value)}
                  quality={qualityByUser[p.userId]}
                />
              ))}
            </div>
          )}
        </div>

        {showChat && (
          <div className="call-chat">
            <div className="call-chat-header">
              <span>#{currentChannel?.name ?? t('call.chatFallback')}</span>
            </div>
            <div className="call-chat-messages">
              {messages.length === 0 ? (
                <p className="call-chat-empty">{t('call.noMessagesYet')}</p>
              ) : (
                messages.map((msg) => {
                  const isFromMe = msg.user_id === user?.id;
                  const displayName = isFromMe
                    ? user!.username
                    : (userCache.get(msg.user_id) ?? msg.user_id.slice(0, 8));
                  return (
                    <div key={msg.id} className={`call-chat-msg ${isFromMe ? 'self' : ''}`}>
                      <span className="call-chat-author">{displayName}</span>
                      <span className="call-chat-time">{formatTime(new Date(msg.created_at))}</span>
                      <p className="call-chat-text">{msg.content}</p>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>
            <form className="call-chat-input" onSubmit={handleSendMessage}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={t('chat.messagePlaceholder', { channel: currentChannel?.name ?? t('call.channelFallback') })}
                maxLength={2000}
              />
              <button type="submit" disabled={!chatInput.trim()}>{t('call.send')}</button>
            </form>
          </div>
        )}
      </div>

      <div className="call-controls">
        <div
          className="mic-btn-wrap"
          style={{ '--mic-level': micLevel } as React.CSSProperties}
        >
          <button
            className={`control-btn ${isMuted ? 'active' : ''}`}
            onClick={handleToggleMute}
            disabled={!isMicAvailable}
            title={!isMicAvailable ? t('call.micUnavailable') : isMuted ? t('call.micOn') : t('call.micOff')}
          >
            {!isMicAvailable ? '🚫' : isMuted ? '🔇' : '🎤'}
          </button>
        </div>
        <button
          className={`control-btn ${isVideoOff ? 'active' : ''}`}
          onClick={handleToggleVideo}
          disabled={isScreenSharing}
          title={isScreenSharing ? t('call.cameraUnavailableSharing') : isVideoOff ? t('call.cameraOn') : t('call.cameraOff')}
        >
          {isVideoOff ? '📷' : '🎥'}
        </button>
        <button
          className={`control-btn ${isScreenSharing ? 'screen-sharing-active' : ''}`}
          onClick={() => { void handleToggleScreenShare(); }}
          title={isScreenSharing ? t('call.stopScreenShare') : t('call.shareScreen')}
        >
          🖥
        </button>
        <button
          className={`control-btn ${showChat ? 'chat-active' : ''}`}
          onClick={() => setShowChat((v) => !v)}
          title={showChat ? t('call.hideChat') : t('call.showChat')}
        >
          💬
        </button>
        <button className="control-btn end-call" onClick={handleLeaveGroupCall} title={t('call.leaveCall')}>
          📞
        </button>
      </div>
    </div>
  );
}
