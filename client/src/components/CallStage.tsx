import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, Maximize2, Minimize2, Mic, MicOff, Video, VideoOff,
  MonitorUp, MonitorPlay, PhoneOff, Expand, Volume2, X,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useCallStore, callWatchState } from '@/stores/callStore';
import type { RemoteParticipant } from '@/stores/callStore';
import { groupCallService } from '@/services/groupCall';
import type { ScreenQuality } from '@/services/groupCall';
import { wsService } from '@/services/websocket';
import { apiService } from '@/services/api';
import { logger } from '@/utils/logger';
import { collectUnresolvedUserIds } from '@/utils/userCache';
import type { User } from '@/types';
import type { DesktopCapturerSource } from '@/types/electron';
import type { ConnectionQualityMetrics, QualityLevel } from '@/utils/callQuality';
import { VolumeControlPopover } from './VolumeControlPopover';
import { ScreenSourcePicker, ScreenQualityPicker } from './ScreenSharePicker';
import { Avatar } from './Avatar';
import { useT, useTp, type TKey } from '@/i18n';
import { useMicLevel } from '@/hooks/useMicLevel';
import { formatCallDuration, stageGridClass, SPEAKING_THRESHOLD } from '@/utils/callStage';
import './CallStage.css';

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
      className={`stage-conn is-${level}`}
      aria-label={ariaLabel}
      onMouseEnter={showTip}
      onMouseLeave={hideTip}
    >
      <span className="stage-conn-bar" />
      <span className="stage-conn-bar" />
      <span className="stage-conn-bar" />
      {tip &&
        createPortal(
          <div
            className={`stage-tip is-${level}`}
            style={{ top: tip.top, left: tip.left }}
            role="tooltip"
          >
            <div className="stage-tip-head">
              <span className="stage-tip-dot" />
              <span className="stage-tip-title">{label}</span>
            </div>
            {level !== 'unknown' && (
              <div className="stage-tip-rows">
                <div className="stage-tip-row">
                  <span className="stage-tip-key">{t('call.qualityLoss')}</span>
                  <span className="stage-tip-val">{packetLoss}{t('call.unitPercent')}</span>
                </div>
                <div className="stage-tip-row">
                  <span className="stage-tip-key">{t('call.qualityPing')}</span>
                  <span className="stage-tip-val">{rtt} {t('call.unitMs')}</span>
                </div>
                <div className="stage-tip-row">
                  <span className="stage-tip-key">{t('call.qualityBitrate')}</span>
                  <span className="stage-tip-val">{bitrate} {t('call.unitKbps')}</span>
                </div>
              </div>
            )}
            <span className="stage-tip-arrow" />
          </div>,
          document.body,
        )}
    </div>
  );
}

// ─── Stage Timer ─────────────────────────────────────────────────────────────
// Board 1e's «В ЭФИРЕ 12:04». Lives in the live pill and ticks once a second;
// `startedAt` survives a reconnect on purpose (callStore.onReconnected does not
// touch it), so the elapsed time keeps counting through a blip.

function StageTimer() {
  const startedAt = useCallStore((s) => s.startedAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return <>{formatCallDuration(now - (startedAt ?? now))}</>;
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
  const speaking = level > SPEAKING_THRESHOLD;
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
    <div
      className={`stage-tile${!participant.stream ? ' is-camera-off' : ''}${speaking ? ' is-speaking' : ''}`}
      style={{ '--speak-level': Math.min(1, level) } as React.CSSProperties}
    >
      {/* Remote video is never mirrored — only the local preview carries is-mirrored. */}
      <video
        ref={videoRefSetter}
        autoPlay
        playsInline
        className="stage-tile-video"
        style={showWatchOverlay ? { display: 'none' } : undefined}
      />
      {!participant.stream && !showWatchOverlay && (
        <Avatar username={displayName} className="stage-tile-avatar" />
      )}
      {showWatchOverlay && (
        <div className="stage-watch-overlay">
          <MonitorPlay size={20} strokeWidth={1.8} />
          <button className="stage-watch-btn" onClick={(e) => { e.stopPropagation(); onFocus(); }}>
            {t('call.watchShare')}
          </button>
        </div>
      )}
      {isSharing && (
        <div className="stage-share-badge">
          <MonitorUp size={12} strokeWidth={1.8} /> {t('call.sharingBadge')}
        </div>
      )}
      <button className="stage-focus-btn" onClick={onFocus} title={t('call.focusParticipant')}>
        <Expand size={14} strokeWidth={1.8} />
      </button>
      <button
        ref={volumeBtnRef}
        className="stage-volume-btn"
        onClick={handleVolumeBtnClick}
        onMouseDown={(e) => e.stopPropagation()}
        title={t('call.volumeLabel', { value: volume })}
      >
        <Volume2 size={14} strokeWidth={1.8} />
      </button>
      {isVolumePopoverOpen && popoverPosition && (
        <VolumeControlPopover
          value={volume}
          position={popoverPosition}
          onChange={onVolumeChange}
          onClose={onCloseVolumePopover}
        />
      )}
      <div className="stage-plate">
        {muted
          ? <span className="stage-plate-mic is-muted"><MicOff size={12} strokeWidth={1.8} /></span>
          : speaking
            ? <span className="stage-eq"><span /><span /><span /></span>
            : <span className="stage-plate-mic"><Mic size={12} strokeWidth={1.8} /></span>}
        <span>{displayName}</span>
      </div>
      {!participant.stream && !showWatchOverlay && (
        <div className="stage-state-chip">{t('call.cameraOffChip')}</div>
      )}
      <ConnectionIndicator metrics={quality} />
    </div>
  );
}

interface CallStageProps {
  // На мобильном сцена и чат — раздельные панели (см. AppPage), а не
  // сплит одной колонки — колбэк переключает мобильную панель обратно на
  // чат. На десктопе не передаётся: там обе панели видны одновременно.
  onMobileBackToChat?: () => void;
}

// Сцена звонка. Рендерится только когда открытый канал совпадает с каналом
// звонка (см. AppPage), поэтому монтируется и размонтируется вместе с
// переключением каналов — всё состояние звонка живёт в сторе, а не здесь.
export function CallStage({ onMobileBackToChat }: CallStageProps) {
  const t = useT();
  const tp = useTp();
  const { user } = useAuthStore();
  // Состояние звонка живёт в сторе: подписка на groupCallService переехала в
  // initCallBridge(), потому что сцена звонка размонтируется при уходе в другой
  // канал, а обработка стримов/реконнекта/метрик должна это пережить.
  const setCall = useCallStore.setState;
  const isInGroupCall = useCallStore((s) => s.callChannelId !== null);
  const callChannelName = useCallStore((s) => s.callChannelName);
  const isReconnecting = useCallStore((s) => s.status === 'reconnecting');
  const isMuted = useCallStore((s) => s.isMuted);
  const isMicAvailable = useCallStore((s) => s.isMicAvailable);
  const isVideoOff = useCallStore((s) => s.isVideoOff);
  const [userCache, setUserCache] = useState<Map<string, string>>(new Map());
  const userCacheRef = useRef(userCache);
  useEffect(() => {
    userCacheRef.current = userCache;
  }, [userCache]);
  const pendingUserFetchesRef = useRef(new Set<string>());
  const participants = useCallStore((s) => s.participants);
  const isScreenSharing = useCallStore((s) => s.isScreenSharing);
  const showSourcePicker = useCallStore((s) => s.showSourcePicker);
  const [screenSources, setScreenSources] = useState<DesktopCapturerSource[]>([]);
  const [showQualityPicker, setShowQualityPicker] = useState(false);
  // null = non-Electron path (getDisplayMedia will pick its own source)
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const screenSharers = useCallStore((s) => s.screenSharers);
  const bannerDismissed = useCallStore((s) => s.bannerDismissed);
  const remoteScreenStreams = useCallStore((s) => s.remoteScreenStreams);
  const focusedUserId = useCallStore((s) => s.focusedUserId);
  // Decision 24: which surface is fullscreen, not merely whether one is —
  // a single boolean sprayed `is-fullscreen` onto the stage AND the focused view.
  const [fullscreenTarget, setFullscreenTarget] = useState<'stage' | 'focus' | null>(null);
  const isFullscreen = fullscreenTarget !== null;
  // Screen-share errors surface as a toast, not a blocking dialog (decision 11).
  const [stageError, setStageError] = useState<string | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const focusedVideoRef = useRef<HTMLVideoElement>(null);
  const screenShareMainRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const remoteMicMuted = useCallStore((s) => s.remoteMicMuted);
  const participantVolumes = useCallStore((s) => s.participantVolumes);
  const volumePopoverUserId = useCallStore((s) => s.volumePopoverUserId);
  const qualityByUser = useCallStore((s) => s.qualityByUser);
  const localQuality = useCallStore((s) => s.localQuality);

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

  // Track fullscreen state changes (ESC key or programmatic exit). The browser
  // path of both toggles sets no state of its own, so the target is derived here
  // from whichever element the browser actually put into fullscreen.
  useEffect(() => {
    const onFsChange = () => {
      const el = document.fullscreenElement;
      setFullscreenTarget(el ? (el === stageRef.current ? 'stage' : 'focus') : null);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Auto-dismiss the stage error toast.
  useEffect(() => {
    if (!stageError) return;
    const timer = setTimeout(() => setStageError(null), 5000);
    return () => clearTimeout(timer);
  }, [stageError]);

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
    const prevWatched = callWatchState.prevWatched;
    if (prevWatched === nextWatched) return;
    if (prevWatched) groupCallService.unwatchShare(prevWatched);
    if (nextWatched) groupCallService.watchShare(nextWatched);
    callWatchState.prevWatched = nextWatched;
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
      setCall((s) => {
        const next = new Set(s.screenSharers);
        next.delete(focusedUserId);
        return { focusedUserId: null, screenSharers: next };
      });
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  }, [participants, focusedUserId]);

  const handleFullscreen = useCallback(async () => {
    const api = (window as Window & typeof globalThis).electronAPI;
    // In Electron the DOM Fullscreen API can silently no-op on the frameless
    // window, so drive fullscreen through the main process instead.
    if (api?.toggleFullscreen) {
      const next = await api.toggleFullscreen().catch(() => null);
      if (typeof next === 'boolean') setFullscreenTarget(next ? 'focus' : null);
      return;
    }
    const container = screenShareMainRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    } else {
      await container.requestFullscreen().catch(() => {});
    }
  }, []);

  // Top-bar fullscreen: the whole stage, not the focused share (decision 24).
  const handleStageFullscreen = useCallback(async () => {
    const api = (window as Window & typeof globalThis).electronAPI;
    if (api?.toggleFullscreen) {
      const next = await api.toggleFullscreen().catch(() => null);
      if (typeof next === 'boolean') setFullscreenTarget(next ? 'stage' : null);
      return;
    }
    const container = stageRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    } else {
      await container.requestFullscreen().catch(() => {});
    }
  }, []);

  const handleLeaveGroupCall = useCallback(() => {
    // leave() сбрасывает стор к IDLE целиком — участники, шареры, фокус и флаги
    // экрана чистятся там же, отдельные setState здесь больше не нужны.
    useCallStore.getState().leave();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);

  const handleVolumeChange = useCallback((userId: string, value: number) => {
    setCall((s) => ({ participantVolumes: { ...s.participantVolumes, [userId]: value } }));
    const videoEl = remoteVideoRefs.current.get(userId);
    if (videoEl) videoEl.volume = value / 100;
  }, []);

  const micLevel = useMicLevel(
    isInGroupCall ? groupCallService.localStreamState : null,
    isMuted,
  );

  const handleToggleMute = useCallback(() => {
    const muted = groupCallService.toggleMuteAudio();
    setCall({ isMuted: muted });
    wsService.send(muted ? 'mic_muted' : 'mic_unmuted', {});
  }, []);

  const handleToggleVideo = useCallback(() => {
    const off = groupCallService.toggleMuteVideo();
    setCall({ isVideoOff: off });
  }, []);

  const handleToggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      await groupCallService.stopScreenShare();
      setCall({ isScreenSharing: false });
      wsService.send('screen_share_stopped', {});
      return;
    }

    const api = (window as Window & typeof globalThis).electronAPI;

    if (api?.getScreenSources) {
      // Electron: fetch sources → source picker → quality picker → start
      const result = await api.getScreenSources();
      if (result.error === 'screen_permission_denied') {
        setStageError(t('call.screenPermissionDenied'));
        return;
      }
      if (result.error || !result.sources?.length) {
        setStageError(t('call.screenSourcesFailed'));
        return;
      }
      setScreenSources(result.sources);
      setCall({ showSourcePicker: true });
    } else {
      // Non-Electron: quality picker first, then getDisplayMedia (OS native picker opens when quality is confirmed)
      setSelectedSourceId(null);
      setShowQualityPicker(true);
    }
  }, [isScreenSharing, t]);

  const handleSelectSource = useCallback((sourceId: string) => {
    setCall({ showSourcePicker: false });
    setSelectedSourceId(sourceId);
    setShowQualityPicker(true);
  }, []);

  const handleSelectQuality = useCallback(async (quality: ScreenQuality) => {
    setShowQualityPicker(false);
    const sourceId = selectedSourceId ?? undefined;
    setSelectedSourceId(null);
    try {
      await groupCallService.startScreenShare(sourceId, quality);
      setCall({ isScreenSharing: true });
      wsService.send('screen_share_started', {});
    } catch (err) {
      // NotAllowedError covers both an explicit permission deny AND the user
      // just closing the OS/browser share picker without choosing anything —
      // by far the most common case. Neither is a bug: don't scare the user
      // with a "failed" alert or spam GlitchTip with an unactionable report
      // for something that happens on every cancelled picker.
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        return;
      }
      logger.error('[GroupCall] Screen share failed:', err, { module: 'groupCallUI' });
      setStageError(t('call.screenShareFailed'));
    }
  }, [selectedSourceId, t]);

  useEffect(() => {
    const fetchUsernames = async () => {
      const userIds = collectUnresolvedUserIds(
        participants.map((p) => p.userId),
        user?.id,
        (id) => userCacheRef.current.has(id),
        (id) => pendingUserFetchesRef.current.has(id)
      );
      for (const uid of userIds) {
        if (pendingUserFetchesRef.current.has(uid) || userCacheRef.current.has(uid)) continue;
        pendingUserFetchesRef.current.add(uid);
        try {
          const fetched = await apiService.getUserById(uid) as User;
          setUserCache((prev) => new Map(prev).set(fetched.id, fetched.username));
        } catch {
          setUserCache((prev) => new Map(prev).set(uid, uid.slice(0, 8)));
        } finally {
          pendingUserFetchesRef.current.delete(uid);
        }
      }
    };
    if (participants.length > 0) fetchUsernames();
  }, [participants, user]);

  if (!isInGroupCall) return null;

  const showSourcePickerModal = showSourcePicker && screenSources.length > 0;

  const totalParticipants = participants.length + 1;

  // Displayed name for the focused participant
  const focusedName = focusedUserId
    ? (userCache.get(focusedUserId) ?? focusedUserId.slice(0, 8))
    : '';
  // First screen sharer ID for the banner
  const firstSharer = screenSharers.size > 0 ? [...screenSharers][0] : null;

  return (
    <div className={`call-stage${fullscreenTarget === 'stage' ? ' is-fullscreen' : ''}`} ref={stageRef}>
      {isReconnecting && (
        <div className="stage-reconnecting">{t('call.reconnecting')}</div>
      )}
      {stageError && <div className="error-toast">{stageError}</div>}
      {showSourcePickerModal && (
        <ScreenSourcePicker
          sources={screenSources}
          onSelect={handleSelectSource}
          onCancel={() => setCall({ showSourcePicker: false })}
        />
      )}
      {showQualityPicker && (
        <ScreenQualityPicker
          onSelect={handleSelectQuality}
          onCancel={() => { setShowQualityPicker(false); setSelectedSourceId(null); }}
        />
      )}
      <div className="stage-topbar">
        {onMobileBackToChat && (
          <button className="stage-back-btn" onClick={onMobileBackToChat} aria-label={t('common.back')}>
            <ArrowLeft size={18} strokeWidth={1.8} />
          </button>
        )}
        <div className="stage-live-pill">
          <span className="stage-live-dot" />
          {t('call.live')} <StageTimer />
        </div>
        <h2 className="stage-title">{callChannelName ? `#${callChannelName}` : t('call.groupCallTitle')}</h2>
        <div className="stage-topbar-right">
          <span className="stage-count-chip">{tp('call.participants', totalParticipants)}</span>
          <button
            className="stage-fullscreen-btn"
            onClick={() => { void handleStageFullscreen(); }}
            aria-label={isFullscreen ? t('call.exitFullscreen') : t('call.fullscreen')}
            title={isFullscreen ? t('call.exitFullscreen') : t('call.fullscreen')}
          >
            {isFullscreen ? <Minimize2 size={16} strokeWidth={1.8} /> : <Maximize2 size={16} strokeWidth={1.8} />}
          </button>
        </div>
      </div>

      <div className="call-body">
        <div className="call-video-area">
          {/* Banner: shown when someone is sharing but user hasn't opened focus view */}
          {firstSharer && !focusedUserId && !bannerDismissed && (
            <div className="stage-share-banner">
              <MonitorUp size={16} strokeWidth={1.8} />
              <span className="stage-share-banner-text">
                {t('call.isSharingScreen', { name: userCache.get(firstSharer) ?? firstSharer.slice(0, 8) })}
              </span>
              <button
                className="stage-share-banner-btn"
                onClick={() => setCall({ focusedUserId: firstSharer })}
              >
                {t('call.view')}
              </button>
              <button
                className="stage-share-banner-dismiss"
                onClick={() => setCall({ bannerDismissed: true })}
                title={t('call.dismiss')}
              >
                <X size={14} strokeWidth={1.8} />
              </button>
            </div>
          )}

          {focusedUserId ? (
            /* ── Focused / screen-share view ── */
            <div className="screen-share-view">
              <div
                className={`screen-share-main${fullscreenTarget === 'focus' ? ' is-fullscreen' : ''}`}
                ref={screenShareMainRef}
              >
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
                    onClick={() => setCall({ focusedUserId: null })}
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
                    onFocus={() => setCall({ focusedUserId: p.userId })}
                    videoRefSetter={(el) => { if (el) remoteVideoRefs.current.set(p.userId, el); }}
                    volume={participantVolumes[p.userId] ?? 100}
                    isVolumePopoverOpen={volumePopoverUserId === p.userId}
                    onToggleVolumePopover={() => setCall((s) => ({ volumePopoverUserId: s.volumePopoverUserId === p.userId ? null : p.userId }))}
                    onCloseVolumePopover={() => setCall({ volumePopoverUserId: null })}
                    onVolumeChange={(value) => handleVolumeChange(p.userId, value)}
                    quality={qualityByUser[p.userId]}
                  />
                ))}
              </div>
            </div>
          ) : (
            /* ── Normal video grid ── */
            <div className={`stage-grid ${stageGridClass(totalParticipants)}`.trim()}>
              {/* Local video */}
              <div
                className={`stage-tile${isVideoOff && !isScreenSharing ? ' is-camera-off' : ''}${micLevel > SPEAKING_THRESHOLD ? ' is-speaking' : ''}`}
                style={{ '--speak-level': Math.min(1, micLevel) } as React.CSSProperties}
              >
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`stage-tile-video${isScreenSharing ? ' is-screen' : ' is-mirrored'}`}
                />
                {isVideoOff && !isScreenSharing && (
                  <Avatar username={user?.username ?? '?'} url={user?.avatar_url} className="stage-tile-avatar" />
                )}
                {isScreenSharing && (
                  <div className="stage-share-badge">
                    <MonitorUp size={12} strokeWidth={1.8} /> {t('call.sharingBadge')}
                  </div>
                )}
                <div className="stage-plate">
                  {isMuted
                    ? <span className="stage-plate-mic is-muted"><MicOff size={12} strokeWidth={1.8} /></span>
                    : micLevel > SPEAKING_THRESHOLD
                      ? <span className="stage-eq"><span /><span /><span /></span>
                      : <span className="stage-plate-mic"><Mic size={12} strokeWidth={1.8} /></span>}
                  <span>{user?.username} {t('call.youSuffix')}</span>
                </div>
                {isVideoOff && !isScreenSharing && (
                  <div className="stage-state-chip">{t('call.cameraOffChip')}</div>
                )}
                <ConnectionIndicator metrics={localQuality} />
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
                  onFocus={() => setCall({ focusedUserId: p.userId })}
                  videoRefSetter={(el) => { if (el) remoteVideoRefs.current.set(p.userId, el); }}
                  volume={participantVolumes[p.userId] ?? 100}
                  isVolumePopoverOpen={volumePopoverUserId === p.userId}
                  onToggleVolumePopover={() => setCall((s) => ({ volumePopoverUserId: s.volumePopoverUserId === p.userId ? null : p.userId }))}
                  onCloseVolumePopover={() => setCall({ volumePopoverUserId: null })}
                  onVolumeChange={(value) => handleVolumeChange(p.userId, value)}
                  quality={qualityByUser[p.userId]}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="stage-controls">
        <div className="stage-ctl">
          <button
            className={`stage-ctl-btn${isMuted ? ' is-off' : ''}`}
            onClick={handleToggleMute}
            disabled={!isMicAvailable}
            title={!isMicAvailable ? t('call.micUnavailable') : isMuted ? t('call.micOn') : t('call.micOff')}
          >
            {isMuted ? <MicOff size={16} strokeWidth={1.8} /> : <Mic size={16} strokeWidth={1.8} />}
          </button>
          <span className="stage-ctl-label">{t('call.ctlMic')}</span>
        </div>
        <div className="stage-ctl">
          <button
            className={`stage-ctl-btn${isVideoOff ? ' is-off' : ''}`}
            onClick={handleToggleVideo}
            disabled={isScreenSharing}
            title={isScreenSharing ? t('call.cameraUnavailableSharing') : isVideoOff ? t('call.cameraOn') : t('call.cameraOff')}
          >
            {isVideoOff ? <VideoOff size={16} strokeWidth={1.8} /> : <Video size={16} strokeWidth={1.8} />}
          </button>
          <span className="stage-ctl-label">{t('call.ctlCamera')}</span>
        </div>
        <div className="stage-ctl">
          <button
            className={`stage-ctl-btn${isScreenSharing ? ' is-on' : ''}`}
            onClick={() => { void handleToggleScreenShare(); }}
            title={isScreenSharing ? t('call.stopScreenShare') : t('call.shareScreen')}
          >
            <MonitorUp size={16} strokeWidth={1.8} />
          </button>
          <span className="stage-ctl-label">{t('call.ctlScreen')}</span>
        </div>
        <div className="stage-ctl-divider" />
        <button className="stage-leave-btn" onClick={handleLeaveGroupCall} title={t('call.leaveCall')}>
          <PhoneOff size={16} strokeWidth={1.8} />
          {t('call.leaveLabel')}
        </button>
      </div>
    </div>
  );
}
