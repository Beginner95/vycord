import { create } from 'zustand';
import { useAuthStore } from '@/stores/authStore';
import { groupCallService } from '@/services/groupCall';
import { wsService } from '@/services/websocket';
import { audioService } from '@/services/audio';
import { logger } from '@/utils/logger';
import type { ConnectionQualityMetrics, QualityLevel } from '@/utils/callQuality';

export type CallStatus = 'idle' | 'joining' | 'connected' | 'reconnecting';

export interface RemoteParticipant {
  userId: string;
  stream: MediaStream | null;
}

export interface JoinCallOptions {
  channelId: string;
  channelName: string;
  serverId: string | null;
  serverName: string | null;
  userId: string;
  userName: string;
}

interface CallState {
  callChannelId: string | null;
  callChannelName: string | null;
  callServerId: string | null;
  callServerName: string | null;
  status: CallStatus;
  isMuted: boolean;
  isVideoOff: boolean;
  isMicAvailable: boolean;
  isScreenSharing: boolean;

  participants: RemoteParticipant[];
  /**
   * userId -> their screen-share MediaStream (video + audio), populated only
   * while we're actively watching them (see onRemoteScreenStream below).
   */
  remoteScreenStreams: Map<string, MediaStream>;
  /** Set of remote user IDs currently sharing their screen */
  screenSharers: Set<string>;
  remoteMicMuted: Map<string, boolean>;
  /** userId -> latest connection-quality metrics received via WS broadcasts. */
  qualityByUser: Record<string, ConnectionQualityMetrics>;
  /** Local outbound (uplink) quality, sampled by groupCallService and reported via onLocalQuality. */
  localQuality: ConnectionQualityMetrics | undefined;
  /** When set, shows the focused layout (large video + thumbnails strip) */
  focusedUserId: string | null;
  /**
   * Controls ONLY the "someone is sharing" banner's visibility. It must never be
   * conflated with screenSharers: clearing that set removes the Watch overlay
   * from every sharing tile and empties the focused view, with no way back until
   * the sharer restarts. Reset whenever a new share starts.
   */
  bannerDismissed: boolean;
  /** userId -> 0-100, local-only, never persisted or sent over WS; missing entry means 100 (default) */
  participantVolumes: Record<string, number>;
  volumePopoverUserId: string | null;
  showSourcePicker: boolean;

  join: (opts: JoinCallOptions) => Promise<void>;
  leave: () => void;
  /** Молчаливый сброс: обрыв связи, вытеснение сессии, исчерпанный реконнект. */
  reset: () => void;
  setStatus: (status: CallStatus) => void;
  toggleMute: () => void;
  toggleVideo: () => void;
}

// Функция, а не константа: Map/Set внутри — мутабельные объекты, и общий
// литерал раздавал бы один и тот же пустой Map на все сбросы подряд.
const idle = () => ({
  callChannelId: null,
  callChannelName: null,
  callServerId: null,
  callServerName: null,
  status: 'idle' as CallStatus,
  isMuted: false,
  isVideoOff: true,
  isMicAvailable: true,
  isScreenSharing: false,
  participants: [] as RemoteParticipant[],
  remoteScreenStreams: new Map<string, MediaStream>(),
  screenSharers: new Set<string>(),
  remoteMicMuted: new Map<string, boolean>(),
  qualityByUser: {} as Record<string, ConnectionQualityMetrics>,
  localQuality: undefined as ConnectionQualityMetrics | undefined,
  focusedUserId: null,
  bannerDismissed: false,
  participantVolumes: {} as Record<string, number>,
  volumePopoverUserId: null,
  showSourcePicker: false,
});

export const useCallStore = create<CallState>((set, get) => ({
  ...idle(),

  join: async (opts) => {
    if (get().status === 'joining') return;
    // Уже активно в этой самой комнате (повторный клик по кнопке входа) — no-op.
    // Без этого гарда groupCallService.joinGroupCall упрётся в собственную
    // защиту «уже в звонке» и уронит ещё живой звонок через onError.
    if (groupCallService.isInGroupCallState && groupCallService.currentRoomIdState === opts.channelId) {
      return;
    }
    // Мид-реконнект: inCall кратковременно false, но currentRoomId уже указывает
    // на восстанавливаемую комнату — тогда повторный voice_joined слать не нужно.
    const alreadyInThisRoom = groupCallService.currentRoomIdState === opts.channelId;

    set({ status: 'joining' });

    let isFirst = false;
    try {
      isFirst = await groupCallService.joinGroupCall(opts.channelId, opts.userId);
    } catch (err) {
      set({ status: 'idle' });
      throw err;
    }

    if (!alreadyInThisRoom && groupCallService.currentRoomIdState === opts.channelId) {
      wsService.send('voice_joined', { channel_id: opts.channelId });
      audioService.playUserJoined();
    }

    const micAvailable = groupCallService.isMicrophoneAvailable;
    set({
      status: 'connected',
      callChannelId: opts.channelId,
      callChannelName: opts.channelName,
      callServerId: opts.serverId,
      callServerName: opts.serverName,
      isMicAvailable: micAvailable,
      isMuted: !micAvailable,
    });
    wsService.send(micAvailable ? 'mic_unmuted' : 'mic_muted', {});

    if (isFirst) {
      wsService.send('voice_call_ring', {
        channel_id: opts.channelId,
        server_id: opts.serverId,
        caller_id: opts.userId,
        caller_name: opts.userName,
        channel_name: opts.channelName,
      });
    }
  },

  leave: () => {
    const channelId = groupCallService.currentRoomIdState;
    if (groupCallService.isScreenSharing) {
      wsService.send('screen_share_stopped', {});
    }
    if (channelId) {
      wsService.send('voice_call_cancel', {
        channel_id: channelId,
        server_id: get().callServerId,
      });
      wsService.send('voice_left', { channel_id: channelId });
      // Звучит только осознанный выход. Обрыв, session_replaced и исчерпанный
      // реконнект приходят в reset() и остаются молчаливыми.
      audioService.playUserLeft();
    }
    groupCallService.leaveGroupCall();
    set(idle());
  },

  reset: () => set(idle()),

  setStatus: (status) => set({ status }),

  toggleMute: () => set({ isMuted: groupCallService.toggleMuteAudio() }),

  toggleVideo: () => set({ isVideoOff: groupCallService.toggleMuteVideo() }),
}));

// ─── Мост к groupCallService ─────────────────────────────────────────────────

/**
 * Tracks which remote user's screen share (if any) we're currently subscribed
 * to via watchShare/unwatchShare. Живёт в модуле (а не в рефе компонента),
 * чтобы onReconnecting/onReconnected и эффект синхронизации в сцене звонка
 * читали и писали одно и то же значение без stale closure и без привязки к
 * жизненному циклу компонента.
 */
export const callWatchState = {
  prevWatched: null as string | null,
};

// Snapshot of callWatchState.prevWatched taken at the start of onReconnecting,
// before focusedUserId is cleared and the sync effect in the call scene clobbers
// prevWatched back to null. onReconnected reads this (not prevWatched) to decide
// whether to resubscribe after the outage.
let watchedBeforeReconnect: string | null = null;

// Throttling state for outgoing connection_quality sends: resend on level
// change, or as a heartbeat at least every 9s.
const qualitySend: { lastLevel: QualityLevel | null; lastSentAt: number } = {
  lastLevel: null,
  lastSentAt: 0,
};

/**
 * Раньше эти проверки были условиями монтирования эффекта в компоненте сцены:
 * подписка ставилась только внутри звонка и знала свой user.id из пропа стора
 * авторизации. Подписки моста живут всё время работы приложения, поэтому те же
 * условия стали ранними выходами внутри обработчиков.
 */
const inCall = (): boolean => useCallStore.getState().callChannelId !== null;
const selfId = (): string | undefined => useAuthStore.getState().user?.id;
const isCallParticipant = (userId: string): boolean =>
  useCallStore.getState().participants.some((p) => p.userId === userId);

let bridgeInitialized = false;

/**
 * Единственная точка подписки на groupCallService. Живёт в модуле, а не в
 * компоненте: сцена звонка размонтируется при уходе в другой канал, и подписка
 * из её useEffect умерла бы вместе с ней — вместе с обработкой входящих
 * стримов, реконнекта и метрик.
 *
 * Идемпотентна: повторные вызовы ничего не делают.
 */
export function initCallBridge(): void {
  if (bridgeInitialized) return;
  bridgeInitialized = true;

  groupCallService.init({
    onRemoteStream: (userId, stream) => {
      useCallStore.setState((s) => {
        const exists = s.participants.find((p) => p.userId === userId);
        if (exists) {
          return {
            participants: s.participants.map((p) =>
              p.userId === userId ? { ...p, stream } : p
            ),
          };
        }
        return { participants: [...s.participants, { userId, stream }] };
      });
      // Здесь раньше стоял быстрый путь: если <video> уже в DOM — приаттачить
      // стрим сразу, «The useEffect below is the fallback for when React
      // re-renders first». remoteVideoRefs — DOM-состояние и остаётся в
      // компоненте сцены, а обновление participants выше всегда даёт новый
      // массив, поэтому эффект сцены гарантированно отрабатывает и аттачит.
    },
    onRemoteScreenStream: (userId, stream) => {
      useCallStore.setState((s) => {
        const next = new Map(s.remoteScreenStreams);
        next.set(userId, stream);
        return { remoteScreenStreams: next };
      });
    },
    onPeerJoined: (userId, source) => {
      useCallStore.setState((s) => {
        if (s.participants.find((p) => p.userId === userId)) return s;
        return { participants: [...s.participants, { userId, stream: null }] };
      });
      // Only a live arrival is an actual join: 'snapshot' peers were already in the
      // room when we connected, which also happens on every auto-reconnect and must
      // stay silent.
      if (source === 'live') audioService.playUserJoined();
      // Fires both when I discover an already-present peer and when someone
      // joins after me — re-announcing my mic state either way is harmless
      // and closes the window where a newly-joined peer doesn't know it yet.
      wsService.send(useCallStore.getState().isMuted ? 'mic_muted' : 'mic_unmuted', {});
    },
    onPeerSnapshot: (userIds) => {
      // Fired once, right after a successful resume (VYC-78 step 3): while
      // this session sat dead in grace, participant_joined/left broadcasts
      // for anyone else were sent to the dead session and lost — this is
      // the only correction that ever arrives, so it must be a real diff
      // against the authoritative list, not just an add like onPeerJoined's
      // 'snapshot' source (which only ever runs on a blank-slate join/full
      // reconnect, where there is nothing stale to remove).
      useCallStore.setState((s) => {
        const idSet = new Set(userIds);
        const kept = s.participants.filter((p) => idSet.has(p.userId));
        const keptIds = new Set(kept.map((p) => p.userId));
        const added = userIds
          .filter((uid) => !keptIds.has(uid))
          .map((uid) => ({ userId: uid, stream: null }));
        return { participants: [...kept, ...added] };
      });
    },
    onPeerLeft: (userId) => {
      // A genuinely live participant_left for someone else's userId always means a real
      // departure. It can also fire with OUR OWN userId when the server evicts a stale
      // session of ours (second-device login, or a reconnect landing inside
      // disconnectedTimeout) — groupCall.ts's handleMessage filters that case out before
      // calling onPeerLeft, so by the time we get here it is always a real departure.
      audioService.playUserLeft();
      useCallStore.setState((s) => {
        const nextScreens = new Map(s.remoteScreenStreams);
        nextScreens.delete(userId);
        const nextMuted = new Map(s.remoteMicMuted);
        nextMuted.delete(userId);
        const nextQuality = { ...s.qualityByUser };
        delete nextQuality[userId];
        return {
          participants: s.participants.filter((p) => p.userId !== userId),
          remoteScreenStreams: nextScreens,
          remoteMicMuted: nextMuted,
          qualityByUser: nextQuality,
        };
      });
    },
    onReconnecting: () => {
      // Snapshot what we were watching BEFORE clearing focusedUserId below —
      // that state update triggers the watch/unwatch sync effect, which would
      // otherwise clobber callWatchState.prevWatched back to null before
      // onReconnected ever gets a chance to read it.
      //
      // Plain assignment (no `?? ` fallback): onReconnected below now restores
      // real focusedUserId/screenSharers state instead of bookkeeping a second
      // ref, so the sync effect reconciles prevWatched with reality after
      // every reconnect cycle. prevWatched is therefore always current by
      // the time the next onReconnecting runs, and a fallback here would only
      // reintroduce the staleness this design removes (e.g. incorrectly
      // resubscribing after a real, explicit unfocus).
      watchedBeforeReconnect = callWatchState.prevWatched;
      // Participants are re-announced via 'joined'/onPeerJoined after
      // rejoin; clear now so users who left during the outage don't linger.
      useCallStore.setState({
        status: 'reconnecting',
        participants: [],
        remoteScreenStreams: new Map(),
        screenSharers: new Set(),
        bannerDismissed: false,
        remoteMicMuted: new Map(),
        participantVolumes: {},
        volumePopoverUserId: null,
        focusedUserId: null,
        qualityByUser: {},
        localQuality: undefined,
      });
    },
    onReconnected: () => {
      useCallStore.setState({ status: 'connected' });
      // Restore real focus/watch state (rather than calling watchShare directly
      // and tracking it in a second ref) so the sync effect in the call scene —
      // the single place that sends watch_share/unwatch_share — naturally
      // reconciles prevWatched with reality on its next run, exactly like any
      // other focus transition. This keeps one source of truth instead of two
      // refs that can drift apart across reconnect cycles.
      const target = watchedBeforeReconnect;
      if (target) {
        useCallStore.setState((s) => ({
          screenSharers: new Set(s.screenSharers).add(target),
          focusedUserId: target,
        }));
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
      useCallStore.setState((s) => {
        const next = new Set(s.screenSharers);
        for (const uid of ids) next.add(uid);
        return { screenSharers: next };
      });
    },
    onCallEnded: () => {
      const channelId = groupCallService.currentRoomIdState;
      if (channelId) wsService.send('voice_left', { channel_id: channelId });
      // Молчаливый сброс: обрыв/вытеснение сессии звука выхода не издаёт.
      useCallStore.getState().reset();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    },
    onError: (msg) => {
      const channelId = groupCallService.currentRoomIdState;
      if (channelId) wsService.send('voice_left', { channel_id: channelId });
      logger.error('[GroupCall] Error:', msg, { module: 'groupCallUI' });
      useCallStore.getState().reset();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      groupCallService.leaveGroupCall();
    },
    onScreenShareEnded: () => {
      useCallStore.setState({ isScreenSharing: false });
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
      useCallStore.setState({ localQuality: metrics });
      const now = Date.now();
      const st = qualitySend;
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

  // ── Входящие события звонка из основного WS ──
  // Живут здесь, а не в сцене звонка, по той же причине, что и подписка на
  // groupCallService: сцена размонтируется при уходе в другой канал, а
  // пропущенный screen_share_stopped оставил бы SFU форвардить мёртвую
  // демонстрацию и протухшие screenSharers/remoteMicMuted/qualityByUser в
  // сторе. Подписки не снимаются — мост идемпотентен и живёт всё время работы
  // приложения.

  wsService.on('screen_share_started', (payload) => {
    const p = payload as { user_id: string };
    if (!inCall()) return;
    if (p.user_id === selfId()) return; // ignore own events
    // Only care about current call participants
    if (!isCallParticipant(p.user_id)) return;
    // A dismissed banner must not stay dismissed for a later, different share.
    useCallStore.setState((s) => ({
      bannerDismissed: false,
      screenSharers: new Set([...s.screenSharers, p.user_id]),
    }));
  });

  wsService.on('screen_share_stopped', (payload) => {
    const p = payload as { user_id: string };
    if (!inCall()) return;
    // Побочный эффект (выход из фуллскрина) держим снаружи апдейтера стора:
    // zustand может вызвать апдейтер повторно, а exitFullscreen() — не идемпотентная
    // операция над DOM.
    const wasFocused = useCallStore.getState().focusedUserId === p.user_id;
    useCallStore.setState((s) => {
      const nextSharers = new Set(s.screenSharers);
      nextSharers.delete(p.user_id);
      const nextStreams = new Map(s.remoteScreenStreams);
      nextStreams.delete(p.user_id);
      // If this participant was focused, exit focus view
      const focusedUserId = s.focusedUserId === p.user_id ? null : s.focusedUserId;
      return { screenSharers: nextSharers, remoteScreenStreams: nextStreams, focusedUserId };
    });
    if (wasFocused && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    groupCallService.unwatchShare(p.user_id);
  });

  wsService.on('mic_muted', (payload) => {
    const p = payload as { user_id: string };
    if (!inCall()) return;
    if (p.user_id === selfId()) return;
    if (!isCallParticipant(p.user_id)) return;
    useCallStore.setState((s) => ({ remoteMicMuted: new Map(s.remoteMicMuted).set(p.user_id, true) }));
  });

  wsService.on('mic_unmuted', (payload) => {
    const p = payload as { user_id: string };
    if (!inCall()) return;
    if (p.user_id === selfId()) return;
    if (!isCallParticipant(p.user_id)) return;
    useCallStore.setState((s) => ({ remoteMicMuted: new Map(s.remoteMicMuted).set(p.user_id, false) }));
  });

  wsService.on('connection_quality', (payload) => {
    const p = payload as { user_id: string; level: QualityLevel; packet_loss: number; rtt: number; bitrate: number };
    if (!inCall()) return;
    if (p.user_id === selfId()) return; // своё качество берём из локального сэмплера
    if (!isCallParticipant(p.user_id)) return;
    useCallStore.setState((s) => ({
      qualityByUser: {
        ...s.qualityByUser,
        [p.user_id]: { level: p.level, packetLoss: p.packet_loss, rtt: p.rtt, bitrate: p.bitrate },
      },
    }));
  });
}
