import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, Maximize2, Minimize2, Mic, MicOff, Video, VideoOff,
  MonitorUp, MonitorPlay, PhoneOff, Expand, Volume2, X, LayoutGrid,
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

// Enters fullscreen on `container`, replacing whatever holds it today.
//
// The plain `container.requestFullscreen()` is not enough, and this is measured,
// not defensive: the fullscreen ELEMENT STACK is a stack. Requesting fullscreen
// on .stage-focus-main while its ancestor .call-stage already holds it PUSHES,
// and the next exitFullscreen() POPS back to .call-stage instead of leaving
// fullscreen. Observed exactly that — after stage → focus → exit, the stage was
// fullscreen again with `is-fullscreen` back on it. Unwinding first keeps the
// stack one deep, so one exit always means out.
async function enterFullscreen(container: HTMLElement): Promise<void> {
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  await container.requestFullscreen().catch(() => {});
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
  const tipRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<
    {
      top: number; left: number; host: HTMLElement; clamped: boolean;
      // M6 T12: `left` is the tooltip's centre AFTER clamping; `anchorLeft` is
      // the indicator's centre, which clamping must not move. `arrowLeft` is the
      // difference, expressed in the tooltip's own coordinates.
      anchorLeft: number; arrowLeft: number | null;
    } | null
  >(null);

  const showTip = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Центрируем над индикатором; фиксированное позиционирование не режется
    // overflow:hidden плитки. Стрелка тултипа смотрит вниз, на индикатор.
    //
    // Портал в document.body невидим, пока какой-то элемент находится в
    // полноэкранном режиме: top layer показывает только сам fullscreen-элемент
    // и его потомков. Кнопка «на весь экран» в шапке (решение 24) делает
    // фуллскрин всей сцены, а вместе с ним — целую сетку наводимых .stage-conn,
    // поэтому цель портала выбирается заново на каждом наведении.
    const host = (document.fullscreenElement as HTMLElement | null) ?? document.body;
    const anchorLeft = r.left + r.width / 2;
    setTip({ top: r.top - 8, left: anchorLeft, host, clamped: false, anchorLeft, arrowLeft: null });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);

  // Наведение — не единственный момент, когда цель портала может устареть:
  // фуллскрин можно включить (F11, кнопка в шапке) или выйти по Esc, пока
  // тултип уже открыт, и тогда он остался бы в прежнем хосте. Пересчитываем
  // хост и позицию на fullscreenchange, пока тултип на экране.
  //
  // resize здесь обязателен, а не «на всякий случай»: вьюпорт меняет размер
  // ПОСЛЕ fullscreenchange, отдельным кадром. Замерено — без этого слушателя
  // прижатие считалось по старой высоте и тултип оказывался за нижней кромкой
  // (bottom 637.3 при innerHeight 544).
  const tipOpen = tip !== null;
  useEffect(() => {
    if (!tipOpen) return;
    const reposition = () => showTip();
    document.addEventListener('fullscreenchange', reposition);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('fullscreenchange', reposition);
      window.removeEventListener('resize', reposition);
    };
  }, [tipOpen, showTip]);

  // Тултип у верхней кромки сцены уезжал за край вьюпорта (замерено: y = -46.5
  // при высоте 120.5). Прижимаем его к вьюпорту по факту измерения. Считаем
  // аналитически из РАЗМЕРА: при transform translate(-50%, -100%) края равны
  // left ± w/2 и [top - h, top], а вход анимируется трансформом — читать
  // позицию живого rect во время анимации значило бы мерить смещение анимации.
  useLayoutEffect(() => {
    if (!tip || tip.clamped) return;
    const el = tipRef.current;
    if (!el) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let { top, left } = tip;
    if (top - h < margin) top = margin + h;
    if (top > vh - margin) top = vh - margin;
    if (left - w / 2 < margin) left = margin + w / 2;
    if (left + w / 2 > vw - margin) left = vw - margin - w / 2;
    // M6 T12: the arrow is `left: 50%` in CSS, i.e. the centre of the TOOLTIP.
    // The two horizontal clamps above move the tooltip without moving the
    // indicator, so as soon as either fired the arrow pointed at empty stage
    // instead of at the chip it belongs to. Re-aim it at the anchor, in the
    // tooltip's own coordinates, and keep it clear of the tooltip's rounded
    // corners. 8px is the arrow's HALF-DIAGONAL rounded up, not half its width:
    // the square is rotate(45deg), so its rendered half-width is
    // 10 / 2 * √2 ≈ 7.07px, and anything under that lets a corner poke out.
    // Set unconditionally: with no clamping this evaluates to exactly w / 2,
    // which is what `left: 50%` already produced — one code path, not two.
    // An inline style rather than a custom property on purpose: a
    // `var(--tip-arrow-x)` would be undeclared to stylelint's
    // value-no-unknown-custom-properties, and giving it a fallback to silence
    // that is precisely what blinds M6 T13's audit gate.
    const arrowLeft = Math.min(w - 8, Math.max(8, tip.anchorLeft - (left - w / 2)));
    setTip({ ...tip, top, left, clamped: true, arrowLeft });
  }, [tip]);

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
            ref={tipRef}
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
            <span
              className="stage-tip-arrow"
              style={tip.arrowLeft === null ? undefined : { left: tip.arrowLeft }}
            />
          </div>,
          tip.host,
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
        className={`stage-thumb${isFocused ? ' is-focused' : ''}${speaking ? ' is-speaking' : ''}`}
        style={{ '--speak-level': Math.min(1, level) } as React.CSSProperties}
        onClick={onFocus}
        title={displayName}
      >
        {/* Remote thumb video is never mirrored — only the local preview is. */}
        <video ref={videoRefSetter} autoPlay playsInline style={showWatchOverlay ? { display: 'none' } : undefined} />
        {!participant.stream && !showWatchOverlay && (
          <Avatar username={displayName} className="stage-thumb-avatar" />
        )}
        {showWatchOverlay && (
          <div className="stage-watch-overlay">
            <MonitorPlay size={16} strokeWidth={1.8} />
            <button className="stage-watch-btn" onClick={(e) => { e.stopPropagation(); onFocus(); }}>
              {t('call.watchShare')}
            </button>
          </div>
        )}
        {isSharing && (
          <div className="stage-thumb-badge">
            <MonitorUp size={10} strokeWidth={1.8} />
          </div>
        )}
        <button
          ref={volumeBtnRef}
          className="stage-volume-btn"
          onClick={handleVolumeBtnClick}
          onMouseDown={(e) => e.stopPropagation()}
          title={t('call.volumeLabel', { value: volume })}
        >
          <Volume2 size={12} strokeWidth={1.8} />
        </button>
        {isVolumePopoverOpen && popoverPosition && (
          <VolumeControlPopover
            value={volume}
            position={popoverPosition}
            onChange={onVolumeChange}
            onClose={onCloseVolumePopover}
          />
        )}
        <ConnectionIndicator metrics={quality} />
        {/* Mic state at thumb scale: the full .stage-plate is too big, and the
            equalizer is illegible at 10px — the is-speaking ring carries that. */}
        <div className="stage-thumb-label">
          {muted
            ? <span className="stage-plate-mic is-muted"><MicOff size={10} strokeWidth={1.8} /></span>
            : <span className="stage-plate-mic"><Mic size={10} strokeWidth={1.8} /></span>}
          <span className="stage-name">{displayName}</span>
        </div>
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
      {/* M6 T12: plate and chip share a flex footer instead of being two
          independently-anchored absolute boxes. See .stage-tile-footer. */}
      <div className="stage-tile-footer">
        <div className="stage-plate">
          {muted
            ? <span className="stage-plate-mic is-muted"><MicOff size={12} strokeWidth={1.8} /></span>
            : speaking
              ? <span className="stage-eq"><span /><span /><span /></span>
              : <span className="stage-plate-mic"><Mic size={12} strokeWidth={1.8} /></span>}
          <span className="stage-name">{displayName}</span>
        </div>
        {!participant.stream && !showWatchOverlay && (
          <div className="stage-state-chip">{t('call.cameraOffChip')}</div>
        )}
      </div>
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
  // Ruling T4-c supersedes P1's "the derived boolean survives for the top bar":
  // each button reads its OWN target, so neither ever shows the exit glyph for
  // a surface that is not fullscreen.
  const [fullscreenTarget, setFullscreenTarget] = useState<'stage' | 'focus' | null>(null);
  const [fullscreenEl, setFullscreenEl] = useState<Element | null>(null);

  // Ruling T4-e — a glyph must reflect what its OWN button's click does, and on
  // the two platforms that is not the same question.
  //
  // Browser: each button owns a distinct element (stageRef / screenShareMainRef)
  // and its handler branches on its own target, so "is MY surface fullscreen"
  // is exactly right — that is what T4-c measured.
  //
  // Electron: there is only ONE window-level fullscreen, and BOTH handlers take
  // the same `api.toggleFullscreen()` branch UNCONDITIONALLY (see the two call
  // sites below) — neither consults fullscreenTarget there. They only differ in
  // the label they stamp afterwards: 'focus' vs 'stage'. So after entering
  // fullscreen from one button, the OTHER button would see `target !== mine`,
  // render Maximize2, and then exit on click — glyph promises enter, action
  // exits. The defect is symmetric: it hits whichever button did not start it.
  // On that path both buttons therefore ask "is anything fullscreen".
  //
  // REASONED, NOT MEASURED: Electron cannot be launched in this environment.
  // To check it in one pass: the predicate below is character-for-character the
  // same test the handlers gate their Electron branch on (`api?.toggleFullscreen`),
  // so wherever that branch runs, this is true.
  //
  // The `is-fullscreen` CLASSES stay per-target on both platforms — they drive
  // the AppPage `:has()` layout for the surface that was actually requested,
  // and exactly one of them is ever set.
  const usesWindowFullscreen = !!(window as Window & typeof globalThis).electronAPI?.toggleFullscreen;
  const stageFullscreenActive = usesWindowFullscreen
    ? fullscreenTarget !== null
    : fullscreenTarget === 'stage';
  const focusFullscreenActive = usesWindowFullscreen
    ? fullscreenTarget !== null
    : fullscreenTarget === 'focus';
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
      // M6 T12: kept as STATE, not read off document during render — the error
      // toast below needs the top-layer element as a portal host and must
      // re-render when it changes. Null on the Electron path, which never sets
      // document.fullscreenElement; that is correct, see the toast.
      setFullscreenEl(el);
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

  // Focused-view fullscreen: only the shared surface (decision 24).
  const handleFocusFullscreen = useCallback(async () => {
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
    // Branch on THIS button's own target, not on document.fullscreenElement:
    // during whole-stage fullscreen the glyph says Maximize2, and the old
    // condition would have exited instead of entering focus fullscreen.
    // enterFullscreen unwinds any existing fullscreen first — see its comment.
    if (fullscreenTarget === 'focus') {
      await document.exitFullscreen().catch(() => {});
    } else {
      await enterFullscreen(container);
    }
  }, [fullscreenTarget]);

  // Top-bar fullscreen: the whole stage, not the focused share (decision 24).
  // Mirror image of the handler above — same own-target branch, so from focus
  // fullscreen this ENTERS stage fullscreen rather than exiting.
  const handleStageFullscreen = useCallback(async () => {
    const api = (window as Window & typeof globalThis).electronAPI;
    if (api?.toggleFullscreen) {
      const next = await api.toggleFullscreen().catch(() => null);
      if (typeof next === 'boolean') setFullscreenTarget(next ? 'stage' : null);
      return;
    }
    const container = stageRef.current;
    if (!container) return;
    if (fullscreenTarget === 'stage') {
      await document.exitFullscreen().catch(() => {});
    } else {
      await enterFullscreen(container);
    }
  }, [fullscreenTarget]);

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
      {/* M6 T12: the toast is a child of .call-stage, but focus fullscreen puts
          .stage-focus-main — a DESCENDANT of the stage — into the top layer, and
          the top layer paints only the fullscreen element and its own
          descendants. So a screen-share error raised while watching a share
          fullscreen rendered into a subtree the compositor was not drawing:
          present in the DOM, auto-dismissed after 5s, never seen. Whole-stage
          fullscreen (decision 24) was always fine — there the stage itself is
          the top-layer element and the toast is inside it.
          Re-targeting a portal on fullscreenchange is the pattern .stage-tip
          already uses in this file for the identical reason; this reuses the
          existing fullscreenchange listener rather than adding a second one.
          fullscreenEl is null on the Electron path (setFullScreen never sets
          document.fullscreenElement) — and correctly so: Electron fullscreen
          uses no top layer, so the in-place toast is visible there already. */}
      {stageError && (
        fullscreenEl && fullscreenTarget === 'focus'
          ? createPortal(<div className="error-toast">{stageError}</div>, fullscreenEl)
          : <div className="error-toast">{stageError}</div>
      )}
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
            aria-label={stageFullscreenActive ? t('call.exitFullscreen') : t('call.fullscreen')}
            title={stageFullscreenActive ? t('call.exitFullscreen') : t('call.fullscreen')}
          >
            {stageFullscreenActive
              ? <Minimize2 size={16} strokeWidth={1.8} />
              : <Maximize2 size={16} strokeWidth={1.8} />}
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
            <div className="stage-focus">
              <div
                className={`stage-focus-main${fullscreenTarget === 'focus' ? ' is-fullscreen' : ''}`}
                ref={screenShareMainRef}
              >
                <video
                  ref={focusedVideoRef}
                  autoPlay
                  playsInline
                  className="stage-focus-video"
                />
                <div className="stage-focus-label">
                  {/* M6 T12: the name is a .stage-name span for the same reason
                      the two plates and two thumb labels are — text-overflow has
                      to live on the flex ITEM, not on the flex container. As a
                      bare text node it had nowhere to put an ellipsis and the
                      label just ran under .stage-focus-main's overflow: hidden. */}
                  <span className="stage-name">{focusedName}</span>
                  {screenSharers.has(focusedUserId) && (
                    <span className="stage-focus-badge">
                      <MonitorUp size={12} strokeWidth={1.8} /> {t('call.sharingBadge')}
                    </span>
                  )}
                </div>
                {/* On the browser path this button owns the FOCUSED surface
                    only, so focusFullscreenActive resolves to
                    fullscreenTarget === 'focus' — whole-stage fullscreen must
                    not render the exit icon here. On the Electron path it
                    resolves to "is anything fullscreen" for the reason spelled
                    out at the state declaration (ruling T4-e). */}
                <div className="stage-focus-controls">
                  <button
                    className="stage-focus-ctrl-btn"
                    onClick={() => { void handleFocusFullscreen(); }}
                    title={focusFullscreenActive ? t('call.exitFullscreen') : t('call.fullscreen')}
                  >
                    {focusFullscreenActive
                      ? <Minimize2 size={16} strokeWidth={1.8} />
                      : <Maximize2 size={16} strokeWidth={1.8} />}
                  </button>
                  <button
                    className="stage-focus-ctrl-btn"
                    onClick={() => setCall({ focusedUserId: null })}
                    title={t('call.backToGrid')}
                  >
                    <LayoutGrid size={16} strokeWidth={1.8} />
                  </button>
                </div>
              </div>

              {/* Thumbnail strip */}
              <div className="stage-thumbs">
                {/* Local thumbnail */}
                <div
                  className={`stage-thumb${micLevel > SPEAKING_THRESHOLD ? ' is-speaking' : ''}`}
                  style={{ '--speak-level': Math.min(1, micLevel) } as React.CSSProperties}
                  title={`${user?.username ?? ''} ${t('call.youSuffix')}`}
                >
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={isScreenSharing ? 'is-screen' : 'is-mirrored'}
                  />
                  {isVideoOff && !isScreenSharing && (
                    <Avatar username={user?.username ?? '?'} url={user?.avatar_url} className="stage-thumb-avatar" />
                  )}
                  {isScreenSharing && (
                    <div className="stage-thumb-badge">
                      <MonitorUp size={10} strokeWidth={1.8} />
                    </div>
                  )}
                  <ConnectionIndicator metrics={localQuality} />
                  <div className="stage-thumb-label">
                    {isMuted
                      ? <span className="stage-plate-mic is-muted"><MicOff size={10} strokeWidth={1.8} /></span>
                      : <span className="stage-plate-mic"><Mic size={10} strokeWidth={1.8} /></span>}
                    <span className="stage-name">{user?.username} {t('call.youSuffix')}</span>
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
                <div className="stage-tile-footer">
                  <div className="stage-plate">
                    {isMuted
                      ? <span className="stage-plate-mic is-muted"><MicOff size={12} strokeWidth={1.8} /></span>
                      : micLevel > SPEAKING_THRESHOLD
                        ? <span className="stage-eq"><span /><span /><span /></span>
                        : <span className="stage-plate-mic"><Mic size={12} strokeWidth={1.8} /></span>}
                    <span className="stage-name">{user?.username} {t('call.youSuffix')}</span>
                  </div>
                  {isVideoOff && !isScreenSharing && (
                    <div className="stage-state-chip">{t('call.cameraOffChip')}</div>
                  )}
                </div>
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
        {/* M6 T15, from manual QA: this was the only control in the bar whose
            label sat INSIDE the button, as a pill, while mic / camera / screen
            all wear `.stage-ctl` — icon-only button with `.stage-ctl-label`
            beneath. It now takes the same shape. The button keeps its own class
            and its danger fill; only the label moved out. `.stage-leave-btn` is
            still the selector probe-stage-mobile.js measures for the 40px tap
            floor, so do not fold it into `.stage-ctl-btn`. */}
        <div className="stage-ctl">
          <button className="stage-leave-btn" onClick={handleLeaveGroupCall} title={t('call.leaveCall')}>
            <PhoneOff size={16} strokeWidth={1.8} />
          </button>
          <span className="stage-ctl-label">{t('call.leaveLabel')}</span>
        </div>
      </div>
    </div>
  );
}
