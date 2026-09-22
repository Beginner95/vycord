import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useCallStore, callWatchState } from '@/stores/callStore';
import type { CallStatus, RemoteParticipant } from '@/stores/callStore';
import { useServerStore } from '@/stores/serverStore';
import { groupCallService } from '@/services/groupCall';
import type { ScreenQuality } from '@/services/groupCall';
import { callBus } from '@/services/callBus';
import { apiService } from '@/services/api';
import { logger } from '@/utils/logger';
import { collectUnresolvedUserIds } from '@/utils/userCache';
import type { User } from '@/types';
import type { DesktopCapturerSource } from '@/types/electron';
import type { ConnectionQualityMetrics } from '@/utils/callQuality';
import { useGuestManagementStore } from '@/stores/guestManagementStore';
import { useMicLevel } from '@/hooks/useMicLevel';
import { useT } from '@/i18n';

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

export interface CallStageModel {
  // Идентичность/права
  user: User | null;
  isGuestMode: boolean;
  isInGroupCall: boolean;
  guestLinksEnabled: boolean;
  callChannelId: string | null;
  callChannelName: string | null;
  totalParticipants: number;
  nameFor: (id: string) => string;

  // Состояние звонка (зеркало callStore, для удобства консюмеров)
  status: CallStatus;
  isReconnecting: boolean;
  isMuted: boolean;
  isMicAvailable: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  participants: RemoteParticipant[];
  screenSharers: Set<string>;
  remoteScreenStreams: Map<string, MediaStream>;
  remoteMicMuted: Map<string, boolean>;
  qualityByUser: Record<string, ConnectionQualityMetrics>;
  localQuality: ConnectionQualityMetrics | undefined;
  focusedUserId: string | null;
  setFocusedUserId: (id: string | null) => void;
  bannerDismissed: boolean;
  dismissBanner: () => void;
  participantVolumes: Record<string, number>;
  volumePopoverUserId: string | null;
  toggleVolumePopover: (userId: string) => void;
  closeVolumePopover: () => void;
  onVolumeChange: (userId: string, value: number) => void;

  // Рефы <video> — консюмер монтирует свои элементы на эти рефы; эффекты
  // хука сами приаттачат стримы, откуда бы ни рендерился элемент.
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  focusedVideoRef: React.RefObject<HTMLVideoElement | null>;
  setRemoteVideoRef: (userId: string, el: HTMLVideoElement | null) => void;
  stageRef: React.RefObject<HTMLDivElement | null>;
  screenShareMainRef: React.RefObject<HTMLDivElement | null>;

  // Фуллскрин (решение 24 / ruling T4-e — перенесено без изменений)
  fullscreenTarget: 'stage' | 'focus' | null;
  stageFullscreenActive: boolean;
  focusFullscreenActive: boolean;
  fullscreenEl: Element | null;
  handleStageFullscreen: () => Promise<void>;
  handleFocusFullscreen: () => Promise<void>;

  // Обработчики
  handleToggleMute: () => void;
  handleToggleVideo: () => void;
  handleToggleScreenShare: () => Promise<void>;
  handleSelectSource: (sourceId: string) => void;
  handleSelectQuality: (quality: ScreenQuality) => Promise<void>;
  handleLeaveGroupCall: () => void;

  // Экранка: источники (Electron) и пикеры
  screenSources: DesktopCapturerSource[];
  showSourcePickerModal: boolean;
  closeSourcePicker: () => void;
  showQualityPicker: boolean;
  closeQualityPicker: () => void;

  // Приглашение гостя (позиция — десктопный поповер; мобиль игнорирует)
  invitePosition: { top: number; left: number } | null;
  inviteBtnRef: React.RefObject<HTMLButtonElement | null>;
  toggleInvitePopover: () => void;
  closeInvitePopover: () => void;

  // Ошибки/предупреждения
  stageError: string | null;
  setStageError: (msg: string | null) => void;

  micLevel: number;

  // Только для передачи в применение sinkId (D7, T6)
  applySinkId: (deviceId: string) => void;
}

export function useCallStageModel({ onLeave }: { onLeave?: () => void } = {}): CallStageModel {
  const t = useT();
  const authUser = useAuthStore((s) => s.user);
  // У гостя нет аккаунта: он сам и имена участников приходят через callStore.
  const guestSelf = useCallStore((s) => s.guestSelf);
  const directory = useCallStore((s) => s.directory);
  const isGuestMode = guestSelf !== null;
  // guestSelf (CallSelf) carries only the fields CallStage actually reads
  // (id/username/avatar_url) — a structural subset of User, not a User. The
  // model's `user` field is typed `User | null` per the brief's contract, so
  // this asserts that subset into the wider shape rather than widening the
  // interface; every read the JSX does (username/avatar_url/id) is safe.
  const user = (guestSelf ?? authUser) as User | null;
  // Состояние звонка живёт в сторе: подписка на groupCallService переехала в
  // initCallBridge(), потому что сцена звонка размонтируется при уходе в другой
  // канал, а обработка стримов/реконнекта/метрик должна это пережить.
  const setCall = useCallStore.setState;
  const callChannelId = useCallStore((s) => s.callChannelId);
  const callServerId = useCallStore((s) => s.callServerId);
  // Кнопка приглашения есть только там, где владелец сервера разрешил гостей:
  // иначе создание ссылки всё равно вернёт 403 (спека, раздел 4).
  const guestLinksEnabled = useServerStore(
    (store) => store.servers.find((srv) => srv.id === callServerId)?.guest_links_enabled ?? false,
  ) && !isGuestMode;
  const isInGroupCall = callChannelId !== null;
  // Гости звонка: их имена приходят событиями хаба, а не из userCache —
  // в users их нет и быть не может.
  const channelGuests = useGuestManagementStore((s) => s.channelGuests);
  const [invitePosition, setInvitePosition] = useState<{ top: number; left: number } | null>(null);
  const inviteBtnRef = useRef<HTMLButtonElement>(null);
  const callChannelName = useCallStore((s) => s.callChannelName);
  const status = useCallStore((s) => s.status);
  const isReconnecting = useCallStore((s) => s.status === 'reconnecting');
  const isMuted = useCallStore((s) => s.isMuted);
  const isMicAvailable = useCallStore((s) => s.isMicAvailable);
  const isVideoOff = useCallStore((s) => s.isVideoOff);
  const [userCache, setUserCache] = useState<Map<string, string>>(new Map());
  const userCacheRef = useRef(userCache);
  // Гость никогда не попадёт в userCache: его имя знает только хаб.
  const nameFor = useCallback(
    (id: string): string => {
      const known = directory[id];
      if (known) return known.username;
      if (id.startsWith('guest:')) {
        for (const guests of channelGuests.values()) {
          const match = guests.find((guest) => guest.id === id);
          if (match) return match.display_name;
        }
        return id.replace('guest:', '').slice(0, 8);
      }
      return userCache.get(id) ?? id.slice(0, 8);
    },
    [channelGuests, userCache, directory],
  );
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
  const mediaWarning = useCallStore((s) => s.mediaWarning);
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

  // Funnel a non-fatal "joined without camera/mic" notice from the store into
  // the same toast used for screen-share errors, then clear it so it can't be
  // shown twice on a later, unrelated re-render.
  useEffect(() => {
    if (!mediaWarning) return;
    setStageError(mediaWarning);
    useCallStore.getState().clearMediaWarning();
  }, [mediaWarning]);

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
    if (onLeave) {
      onLeave();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      return;
    }
    // leave() сбрасывает стор к IDLE целиком — участники, шареры, фокус и флаги
    // экрана чистятся там же, отдельные setState здесь больше не нужны.
    useCallStore.getState().leave();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, [onLeave]);

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
    callBus.send(muted ? 'mic_muted' : 'mic_unmuted', {});
  }, []);

  const handleToggleVideo = useCallback(() => {
    const off = groupCallService.toggleMuteVideo();
    setCall({ isVideoOff: off });
  }, []);

  const handleToggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      await groupCallService.stopScreenShare();
      setCall({ isScreenSharing: false });
      callBus.send('screen_share_stopped', {});
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
      callBus.send('screen_share_started', {});
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
    // Гостю /users/{id} недоступен: имена он знает только из состава звонка.
    if (isGuestMode) return;
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
  }, [participants, user, isGuestMode]);

  const showSourcePickerModal = showSourcePicker && screenSources.length > 0;

  const totalParticipants = participants.length + 1;

  const setFocusedUserId = useCallback((id: string | null) => setCall({ focusedUserId: id }), []);
  const dismissBanner = useCallback(() => setCall({ bannerDismissed: true }), []);
  const toggleVolumePopover = useCallback(
    (userId: string) => setCall((s) => ({ volumePopoverUserId: s.volumePopoverUserId === userId ? null : userId })),
    [],
  );
  const closeVolumePopover = useCallback(() => setCall({ volumePopoverUserId: null }), []);
  const closeSourcePicker = useCallback(() => setCall({ showSourcePicker: false }), []);
  const closeQualityPicker = useCallback(() => {
    setShowQualityPicker(false);
    setSelectedSourceId(null);
  }, []);
  const toggleInvitePopover = useCallback(() => {
    if (invitePosition) {
      setInvitePosition(null);
      return;
    }
    const rect = inviteBtnRef.current?.getBoundingClientRect();
    if (rect) setInvitePosition({ top: rect.top - 8, left: rect.left });
  }, [invitePosition]);
  const closeInvitePopover = useCallback(() => setInvitePosition(null), []);

  const remoteVideoRefsMap = remoteVideoRefs; // уже существует как useRef<Map<...>>
  const setRemoteVideoRef = useCallback((userId: string, el: HTMLVideoElement | null) => {
    if (el) remoteVideoRefsMap.current.set(userId, el);
    else remoteVideoRefsMap.current.delete(userId);
  }, []);
  const applySinkId = useCallback((deviceId: string) => {
    const els = [focusedVideoRef.current, ...remoteVideoRefsMap.current.values()].filter(
      (el): el is HTMLVideoElement => el !== null,
    );
    for (const el of els) {
      const withSink = el as HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> };
      withSink.setSinkId?.(deviceId).catch(() => {});
    }
  }, []);

  return {
    user,
    isGuestMode,
    isInGroupCall,
    guestLinksEnabled,
    callChannelId,
    callChannelName,
    totalParticipants,
    nameFor,

    status,
    isReconnecting,
    isMuted,
    isMicAvailable,
    isVideoOff,
    isScreenSharing,
    participants,
    screenSharers,
    remoteScreenStreams,
    remoteMicMuted,
    qualityByUser,
    localQuality,
    focusedUserId,
    setFocusedUserId,
    bannerDismissed,
    dismissBanner,
    participantVolumes,
    volumePopoverUserId,
    toggleVolumePopover,
    closeVolumePopover,
    onVolumeChange: handleVolumeChange,

    localVideoRef,
    focusedVideoRef,
    setRemoteVideoRef,
    stageRef,
    screenShareMainRef,

    fullscreenTarget,
    stageFullscreenActive,
    focusFullscreenActive,
    fullscreenEl,
    handleStageFullscreen,
    handleFocusFullscreen,

    handleToggleMute,
    handleToggleVideo,
    handleToggleScreenShare,
    handleSelectSource,
    handleSelectQuality,
    handleLeaveGroupCall,

    screenSources,
    showSourcePickerModal,
    closeSourcePicker,
    showQualityPicker,
    closeQualityPicker,

    invitePosition,
    inviteBtnRef,
    toggleInvitePopover,
    closeInvitePopover,

    stageError,
    setStageError,

    micLevel,

    applySinkId,
  };
}
