import { noiseCancellationService } from './noiseCancellation';
import { echoCancellationService } from './echoCancellation';
import { getIceServers, STUN_SERVERS } from './iceConfig';
import { ConnectionRecovery } from './connectionRecovery';
import { computeQualityLevel, type ConnectionQualityMetrics } from '@/utils/callQuality';
import { apiService, apiErrorText } from './api';
import { logger } from '@/utils/logger';
// Нехуковый t: groupCall — обычный класс, useT() здесь вызвать нельзя.
import { t } from '@/i18n';

const SFU_URL = import.meta.env.VITE_SFU_URL || 'ws://localhost:8081';

// ─── Screen quality presets ───────────────────────────────────────────────────

export interface ScreenQualityPreset {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  // Sender-side encoder cap (bps). Without an explicit cap Chrome limits VP8 to
  // ~2.5 Mbps, which starves 1080p+ screen content: the encoder hits the ceiling
  // and drops frames, so the share turns into a slideshow even on a good link.
  readonly maxBitrate: number;
}

export const SCREEN_QUALITY_PRESETS = {
  '720p':  { label: '720p',  width: 1280, height:  720, frameRate: 30, maxBitrate: 3_000_000 },
  '1080p': { label: '1080p', width: 1920, height: 1080, frameRate: 30, maxBitrate: 5_000_000 },
  '2K':    { label: '2K',    width: 2560, height: 1440, frameRate: 30, maxBitrate: 8_000_000 },
} as const satisfies Record<string, ScreenQualityPreset>;

export type ScreenQuality = keyof typeof SCREEN_QUALITY_PRESETS;

// ─── Debug logger ────────────────────────────────────────────────────────────

function gcLog(userId: string, action: string, data?: Record<string, unknown>): void {
  const ts = new Date().toISOString().slice(11, 23);
  const uid = userId ? userId.slice(0, 8) : '--------';
  const prefix = `[GC ${ts} | ${uid} | ${action}]`;
  if (data !== undefined) {
    console.log(prefix, data);
  } else {
    console.log(prefix);
  }
}

// Explicit constraints avoid macOS/Android-specific quirks:
// - channelCount ideal:1 → Opus mono, prevents macOS from injecting stereo fmtp params
//   that older pion versions may not accept (stereo=1;sprop-stereo=1 mismatch).
// - sampleRate ideal:48000 → Opus native rate; avoids resampling artefacts on Android.
// Using ideal: (not exact) so the browser still works on devices that can't hit 48kHz.
// Module-level: acquireMedia and rebuildMicPipeline must capture identically.
const MIC_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 48000 },
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

// Non-reversible 8-hex digest: device signatures embed personal device names
// ("Ivan's AirPods"); telemetry needs same/different only. Full strings stay in gcLog.
function sigDigest(sig: string): string {
  let h = 5381;
  for (let i = 0; i < sig.length; i++) h = ((h << 5) + h + sig.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

// defaultMicSignature values that are states, not device identities — never a
// rebuild baseline or trigger; a later tick with a real device recovers.
const MIC_SIG_SENTINELS = new Set(['', 'unknown', 'none', 'no-default-entry']);

// Parses SDP and extracts per-m-section info: direction, SSRCs, msid, mid.
function parseSdpSections(sdp: string): Array<Record<string, unknown>> {
  const sections: Array<Record<string, unknown>> = [];
  let current: Record<string, unknown> | null = null;

  for (const raw of sdp.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith('m=')) {
      if (current) sections.push(current);
      current = { mLine: line, direction: 'sendrecv', ssrcs: [], msids: [], mid: null };
    } else if (current) {
      if (/^a=(sendonly|recvonly|sendrecv|inactive)$/.test(line)) {
        current.direction = line.slice(2);
      } else if (line.startsWith('a=ssrc:')) {
        (current.ssrcs as string[]).push(line.slice(7, 25));
      } else if (line.startsWith('a=msid:')) {
        (current.msids as string[]).push(line.slice(7));
      } else if (line.startsWith('a=mid:')) {
        current.mid = line.slice(6);
      }
    }
  }
  if (current) sections.push(current);
  return sections;
}

// ─── Signaling protocol types ────────────────────────────────────────────────

interface SignalingMessage {
  type: string;
  payload: unknown;
}

interface JoinedPayload {
  room_id: string;
  existing_peers: string[];
  // userIds of peers already sharing their screen when we (re)joined. The app-WS
  // 'screen_share_started' broadcast is fire-and-forget and late joiners miss it,
  // so this snapshot is the only way a viewer learns about an already-active share.
  sharing_peers?: string[];
  // Lets a later dropped WebSocket reattach to this exact PeerConnection
  // (no renegotiation, no jitter-buffer reset for anyone else) instead of a
  // full rejoin — see attemptResume / the 'resumed' message.
  resume_token?: string;
}

// ResumedPayload confirms a resume_token reattached successfully. existing_peers/
// sharing_peers resync the participant list against changes missed while this
// session sat dead in grace (participant_joined/left broadcasts sent to a dead
// session are lost — nothing queues them for replay) — see onPeerSnapshot.
interface ResumedPayload {
  room_id: string;
  existing_peers: string[];
  sharing_peers?: string[];
}

interface OfferPayload {
  type: 'offer';
  sdp: string;
}

interface IceCandidatePayload {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment: string | null;
}

interface ParticipantEventPayload {
  user_id: string;
}

interface ErrorPayload {
  code: string;
  message: string;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface GroupCallCallbacks {
  onRemoteStream: (userId: string, stream: MediaStream) => void;
  // Fired when a remote participant's screen-share video/audio arrives —
  // separate from onRemoteStream (camera/mic), since screen tracks are only
  // delivered to subscribers who called watchShare().
  onRemoteScreenStream: (userId: string, stream: MediaStream) => void;
  // source='snapshot' — peer was already in the room when we connected (also fires on
  // every successful auto-reconnect); source='live' — peer arrived just now.
  // Consumers that notify the user must react only to 'live'.
  onPeerJoined: (userId: string, source: 'snapshot' | 'live') => void;
  onPeerLeft: (userId: string) => void;
  // Fired after a successful resume (attemptResume) with the authoritative
  // full participant list at that moment — a normal reconnect re-announces
  // everyone via a fresh 'joined', but resume deliberately skips that (nobody
  // else needs to renegotiate for a resume), so this is the only signal that
  // corrects anyone who joined or left while this session sat dead in grace.
  // The UI layer must diff its own list against this, not just add: someone
  // present in its old list but absent here left during the grace window.
  onPeerSnapshot?: (userIds: string[]) => void;
  onCallEnded: () => void;
  onError: (error: string) => void;
  // Called when the OS screen-capture source is closed by the user (e.g. stop button in Chrome bar).
  onScreenShareEnded?: () => void;
  // Fired after auto-reconnect re-attached OUR OWN outgoing screen share to the
  // new PeerConnection. The SFU-level screen_share_start sent alongside it only
  // flips the server's sharingActive flag; other participants' UI state comes
  // from the app-level 'screen_share_started' broadcast, which they dropped
  // when our session went away — so the UI layer must re-announce it here.
  onScreenShareRestored?: () => void;
  // Fired when the call dropped due to a network change and auto-reconnect started.
  onReconnecting?: () => void;
  // Fired when auto-reconnect restored the call.
  onReconnected?: () => void;
  // Called on 'joined' with the userIds of peers who are screen-sharing right now
  // (authoritative snapshot from the SFU — the app-WS broadcast is missed by
  // late joiners/reconnects). Replaces any previously-known share state.
  onSharingPeers?: (userIds: string[]) => void;
  // Fired periodically with the local user's uplink connection-quality sample.
  onLocalQuality?: (metrics: ConnectionQualityMetrics) => void;
}

// ─── Internal state ──────────────────────────────────────────────────────────

// Maps stream ID (= remote user ID) to the MediaStream accumulating their tracks.
type RemoteStreams = Map<string, MediaStream>;

class GroupCallService {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  // Lets a dropped WebSocket reattach to the SAME ParticipantSession server-side
  // (VYC-78 step 3) instead of a full rejoin. Issued in 'joined', constant for
  // the life of one call; cleared on teardown so a later, unrelated call never
  // carries a stale one.
  private resumeToken: string | null = null;
  // Refreshed on every joinGroupCall; TURN entries carry ephemeral credentials.
  private iceServers: RTCIceServer[] = STUN_SERVERS;
  private localStream: MediaStream | null = null;

  private screenStream: MediaStream | null = null;
  // Dedicated senders for the screen-share slots pre-provisioned in
  // createPeerConnection — separate from the camera/mic senders, so the SFU
  // can gate them independently of camera/mic (see WatchShare on the server).
  private screenVideoSender: RTCRtpSender | null = null;
  private screenAudioSender: RTCRtpSender | null = null;
  // Placeholder video track for the screen-video slot — mirrors dummyVideoTrack
  // below, but for the dedicated screen slot (not the camera slot).
  private dummyScreenVideoTrack: MediaStreamTrack | null = null;
  // Placeholder audio track for the screen-audio slot, plus the AudioContext
  // that produces it. The context MUST be kept and closed explicitly: every
  // createPeerConnection() builds a new one, and a long Electron session with
  // several auto-reconnects would otherwise accumulate contexts until Chromium's
  // per-renderer cap makes `new AudioContext()` throw, breaking every later join.
  private dummyScreenAudioTrack: MediaStreamTrack | null = null;
  private dummyScreenAudioContext: AudioContext | null = null;
  // Silent placeholder track for the mic slot when no microphone is present, so
  // the slot is non-empty and the screen-audio addTrack below can't reuse (and
  // thereby collapse) it. Managed like dummyScreenAudioTrack.
  private dummyMicAudioTrack: MediaStreamTrack | null = null;
  private dummyMicAudioContext: AudioContext | null = null;
  // Detaches the AEC3 AudioWorkletNode/worker used to strip call-audio echo
  // out of the captured system audio before it is sent via screenAudioSender —
  // see startScreenShare/stopScreenShare.
  private screenAecDetach: (() => void) | null = null;
  // Placeholder video track sent when no camera is available — see createDummyVideoTrack.
  private dummyVideoTrack: MediaStreamTrack | null = null;
  private _isScreenSharing = false;
  private _microphoneAvailable = false;
  // Tracked explicitly because toggleMuteAudio no longer reads mute state off
  // track.enabled — the track must stay enabled so mixed-in screen-share
  // audio (same physical track) is never silenced by mic mute.
  private micMuted = false;

  // Keyed by the remote user's ID (= pion stream ID on track events).
  private remoteStreams: RemoteStreams = new Map();

  // Screen-share streams, keyed by the remote user's ID — separate from
  // remoteStreams (camera/mic) since these only exist for watched shares.
  private remoteScreenStreams: RemoteStreams = new Map();

  // ICE candidates buffered before setRemoteDescription has been called.
  private pendingCandidates: RTCIceCandidateInit[] = [];

  private callbacks: GroupCallCallbacks | null = null;
  private currentUserId = '';
  private currentRoomId = '';
  private inCall = false;
  // True while joinGroupCall is in flight. inCall becomes true only when
  // 'joined' arrives, so without this flag a double-click on the voice channel
  // slips past the inCall guard (media acquisition takes ~1-2s) and opens two
  // parallel SFU connections for the same user.
  private joining = false;

  // True once the user asked to leave — suppresses auto-reconnect (Task 3).
  private intentionalLeave = false;
  // True while the reconnect loop owns the WS/PC lifecycle — suppresses
  // onclose/onerror side effects from failed attempts.
  private reconnecting = false;
  // Bumped by every fresh doJoinGroupCall. Lets an in-flight reconnect() loop
  // (started by an earlier drop) notice a newer join has since taken over and
  // stop competing for the connection instead of opening a second, doomed
  // WebSocket that can clobber `this.ws`/fire a spurious onError onto an
  // already-healthy call (VYC-74).
  private sessionEpoch = 0;
  // Escalation ladder for a PC that goes 'disconnected': let ICE heal itself,
  // then ask the SFU for an ICE restart, and only then rejoin the room. The
  // browser can sit in 'disconnected' for tens of seconds before 'failed' while
  // the WS hangs half-open (VPN case), so we can't simply wait for 'failed'.
  private recovery: ConnectionRecovery | null = null;
  // Screen track waiting to be re-attached to the new PC after reconnect.
  private pendingScreenRestore: MediaStreamTrack | null = null;
  // Periodic uplink connection-quality sampler (separate from the debug stats logger below).
  private qualityIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastBytesSent = 0;
  private lastBytesSentAt = 0;
  // VYC-76 uplink pacing diagnostics — previous sample, for per-tick deltas.
  private lastPacingAt = 0;
  private lastAudioPacketsSent = 0;
  private lastPacketSendDelay = 0;
  private lastSamplesDuration = 0;
  // Throttle state for VYC-76 GlitchTip reports, keyed by anomaly kind.
  // The samplers tick every 2-3s; an anomaly that lasts a while would otherwise
  // fire a report per tick per remote track and flood the issue.
  private vyc76LastReportAt = new Map<string, number>();
  private vyc76ReportCount = 0;

  // ── Mic-device watch ──
  // The mic is captured once from the OS default device and lives in a
  // 48kHz-pinned AudioContext for the whole call. A mid-call default-input
  // change (Bluetooth HFP at 16/24 kHz) can leave Chromium's capture resampler
  // stale → the published track is genuinely time-compressed ("talks 2x fast"),
  // and no recovery path rebuilds the chain. The watch does, in place.
  private micWatchIntervalId: ReturnType<typeof setInterval> | null = null;
  private micWatchDebounceId: ReturnType<typeof setTimeout> | null = null;
  private micDeviceSignature = '';
  private micRebuildInFlight = false;
  private micRebuildCount = 0;
  // Damping: no rebuilds before this timestamp — 15s after success (5min once
  // a call rebuilt 5 times), exponential 30s→5min after failures.
  private micRebuildBlockedUntil = 0;
  private micRebuildFailures = 0;
  // Ownership token: a hung rebuild settling during a LATER call must not
  // clear a lock the successor call now holds.
  private micRebuildToken = 0;
  // Field arrow, not a method: add/removeEventListener need a stable reference.
  private readonly onDeviceChange = (): void => {
    // Bluetooth profile flips fire devicechange in bursts; let the dust settle.
    if (this.micWatchDebounceId !== null) clearTimeout(this.micWatchDebounceId);
    this.micWatchDebounceId = setTimeout(() => {
      this.micWatchDebounceId = null;
      void this.checkMicMigration('devicechange');
    }, 1000);
  };
  // Selected ICE candidate pair, as "localType/proto → remoteType/proto".
  // Empty until the first sample; used to detect mid-call path moves.
  private lastIcePath = '';
  private icePathChanges = 0;
  // VYC-76 fast uplink sampler: 500ms pps samples covering one 3s pacing tick.
  private uplinkFastIntervalId: ReturnType<typeof setInterval> | null = null;
  private uplinkPpsWindow: number[] = [];
  private lastFastPacketsSent = 0;
  private lastFastSampleAt = 0;

  // Timestamps for mobile diagnostic metrics (milliseconds since epoch).
  private joinedAt = 0;
  private pcCreatedAt = 0;
  private pcConnectedAt = 0;
  private firstAudioFrameAt: Map<string, number> = new Map();

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  init(callbacks: GroupCallCallbacks): void {
    this.callbacks = callbacks;
  }

  async joinGroupCall(roomId: string, userId: string): Promise<boolean> {
    gcLog(userId, 'joinGroupCall', { roomId });

    if (this.inCall) {
      this.callbacks?.onError('Already in a call');
      return false;
    }
    if (this.joining) {
      // No onError here: this is a benign repeated click while the first join
      // is still acquiring media/connecting — onError would tear down the call.
      gcLog(userId, 'joinGroupCall ignored: join already in progress');
      return false;
    }
    this.joining = true;
    try {
      return await this.doJoinGroupCall(roomId, userId);
    } finally {
      this.joining = false;
    }
  }

  private async doJoinGroupCall(roomId: string, userId: string): Promise<boolean> {
    this.intentionalLeave = false;
    // A hung previous reconnect cycle (e.g. its attempt never settled) must not
    // silently disable auto-reconnect for this new call.
    this.reconnecting = false;
    // Invalidate any reconnect() loop still running from an earlier drop —
    // see sessionEpoch's comment.
    this.sessionEpoch++;
    this.currentUserId = userId;
    this.currentRoomId = roomId;
    // Per-call damping; a partialTeardown-based rejoin skips full teardown.
    this.micRebuildCount = 0;
    this.micRebuildFailures = 0;
    this.micRebuildBlockedUntil = 0;

    try {
      const raw = await this.acquireMedia();
      // Baseline BEFORE the seconds-long createChain: a device flip inside
      // that window must be detected, not recorded as the baseline.
      const micBaselineSig = raw !== null ? this.defaultMicSignature() : null;
      if (raw !== null) {
        this._microphoneAvailable = raw.getAudioTracks().length > 0;
        // Единая Web Audio цепочка NC-сервиса: worklet при включённом NC, bypass
        // при выключенном. Пропуск через Web Audio обязателен в обоих режимах —
        // Chrome's push-model audio capture may fail silently on certain hardware
        // (track reports live/enabled but Opus gets zero frames); pull-model
        // рендер всегда производит фреймы. Без аудиотреков createChain вернёт
        // raw как есть.
        this.localStream = await noiseCancellationService.createChain(raw);
        // Video starts disabled to avoid immediate bandwidth spike.
        this.localStream.getVideoTracks().forEach((t) => { t.enabled = false; });
        gcLog(userId, 'media acquired', {
          audioTracks: this.localStream.getAudioTracks().map((t) => ({
            id: t.id.slice(0, 8), label: t.label, enabled: t.enabled,
            readyState: t.readyState, muted: t.muted,
            settings: t.getSettings(),
          })),
          videoTracks: this.localStream.getVideoTracks().map((t) => ({
            id: t.id.slice(0, 8), label: t.label, enabled: t.enabled,
            readyState: t.readyState, muted: t.muted,
            settings: t.getSettings(),
          })),
          noiseCancellationEnabled: noiseCancellationService.getState().isEnabled,
        });
        this.startMicWatch(micBaselineSig !== null ? await micBaselineSig : '');
      } else {
        this._microphoneAvailable = false;
        gcLog(userId, 'no media devices, joining without local media');
      }
    } catch (err) {
      gcLog(userId, 'media ERROR', { error: String(err) });
      this._microphoneAvailable = false;
      gcLog(userId, 'continuing without local media after unexpected error');
    }

    return this.connect(roomId, userId);
  }

  leaveGroupCall(): void {
    this.intentionalLeave = true;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'leave', payload: {} }));
      this.ws.close();
    }
    this.teardown();
  }

  // ── Auto-reconnect ─────────────────────────────────────────────────────────

  private async reconnect(trigger: string): Promise<void> {
    if (this.reconnecting || this.intentionalLeave || !this.inCall) return;
    this.reconnecting = true;
    const mySession = this.sessionEpoch;
    gcLog(this.currentUserId, 'reconnect: started', { trigger });
    this.callbacks?.onReconnecting?.();

    // A live local screen track survives a network change — remember it to
    // re-attach to the new PC. Mic/camera mute needs no snapshot: localStream
    // tracks are reused as-is, and mute state persists either way — via
    // micGain.gain when an NC chain exists, or via .enabled as a fallback
    // when it doesn't (see toggleMuteAudio).
    const screenTrack = this._isScreenSharing
      ? this.screenStream?.getVideoTracks()[0] ?? null
      : null;

    if (await this.attemptResume(mySession)) {
      this.reconnecting = false;
      gcLog(this.currentUserId, 'reconnect: resumed the existing PeerConnection over a new WebSocket');
      this.callbacks?.onReconnected?.();
      return;
    }

    this.partialTeardown();

    // ~30s total.
    const delaysMs = [500, 1000, 2000, 4000, 8000, 8000, 8000];
    for (const [attempt, delay] of delaysMs.entries()) {
      await new Promise((r) => setTimeout(r, delay));
      if (this.intentionalLeave) {
        this.reconnecting = false;
        return;
      }
      if (mySession !== this.sessionEpoch) {
        // A fresh joinGroupCall() already re-established the call while we
        // were waiting — don't open a competing WebSocket for a call that's
        // already up.
        this.reconnecting = false;
        gcLog(this.currentUserId, 'reconnect: superseded by a new join, stopping');
        return;
      }
      gcLog(this.currentUserId, 'reconnect: attempt', { attempt: attempt + 1, delay });
      try {
        await this.connect(this.currentRoomId, this.currentUserId);
      } catch (err) {
        gcLog(this.currentUserId, 'reconnect: attempt failed', { error: String(err) });
      }
      // connectSignaling's boolean means "alone in room", not success —
      // success is inCall (set on 'joined') plus an open WS.
      if (this.inCall && this.ws?.readyState === WebSocket.OPEN) {
        this.restoreScreenShare(screenTrack);
        this.reconnecting = false;
        gcLog(this.currentUserId, 'reconnect: succeeded', { attempt: attempt + 1 });
        this.callbacks?.onReconnected?.();
        return;
      }
    }

    this.reconnecting = false;
    gcLog(this.currentUserId, 'reconnect: gave up');
    // onCallEnded must run before teardown(): initCallBridge's onCallEnded reads
    // currentRoomIdState to send voice_left, and teardown() now clears
    // currentRoomId — see the onclose handler above for the same ordering.
    this.callbacks?.onCallEnded();
    this.teardown();
  }

  // attemptResume tries the cheap path before reconnect() falls back to a full
  // rejoin: dial a NEW WebSocket carrying resumeToken, and if the server
  // confirms with 'resumed', keep the EXISTING PeerConnection exactly as it
  // was — no new PC, no renegotiation, no jitter-buffer reset for anyone else
  // in the room. Returns false for anything that isn't a clean success
  // (no token, dead PC, server fell back to a fresh join, network failure,
  // timeout) — the caller's existing full-reconnect loop is the fallback and
  // needs no help distinguishing why.
  private async attemptResume(mySession: number): Promise<boolean> {
    if (!this.resumeToken || !this.pc) return false;
    // A PeerConnection that has already failed or closed has nothing left to
    // resume onto — only a fresh PC (the normal reconnect path) can recover it.
    if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') return false;

    const roomId = this.currentRoomId;
    const userId = this.currentUserId;
    const resumeToken = this.resumeToken;

    let token: string;
    try {
      const resp = await apiService.getVoiceToken(roomId);
      token = resp.token;
    } catch (err) {
      gcLog(userId, 'resume: failed to obtain voice token', { error: String(err) });
      return false;
    }

    if (mySession !== this.sessionEpoch) return false;

    const url = `${SFU_URL}/ws?room_id=${encodeURIComponent(roomId)}&token=${encodeURIComponent(token)}&resume_token=${encodeURIComponent(resumeToken)}`;
    const socket = new WebSocket(url);

    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const settle = (v: boolean) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(resumeTimeout);
        resolve(v);
      };
      const abandon = () => {
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.close();
      };

      // A message can legitimately arrive before we know whether this
      // connection is resuming or falling back to a fresh join — the server
      // sends 'resumed' synchronously in ServeHTTP right after Resume()
      // succeeds, but Resume() already reattached the session and triggered
      // the negotiator by then, so an offer/answer/ICE-candidate exchange can
      // start racing ahead of that 'resumed' notify over the same goroutine
      // scheduling that makes 'offer before joined' possible on a fresh join
      // too. The two cases need OPPOSITE handling of anything queued here: a
      // resume must replay it (it belongs to the OLD pc we are keeping), a
      // fallback join must discard it (it would belong to a PC this client
      // never creates on this socket — this.pc still points at the old one).
      // So nothing in between can be acted on until we know which; only
      // 'resumed' or 'joined' resolves the ambiguity.
      const pending: SignalingMessage[] = [];

      // Resume must be fast — the server only holds the grace window open for
      // a bounded time (15s by default) — so a hung dial falls back to the
      // ordinary reconnect loop rather than eating into that budget.
      const resumeTimeout = setTimeout(() => {
        gcLog(userId, 'resume: timed out');
        abandon();
        settle(false);
      }, 5000);

      socket.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as SignalingMessage;
        if (msg.type === 'resumed') {
          if (mySession !== this.sessionEpoch) {
            gcLog(userId, 'resume: superseded by a new join, abandoning');
            abandon();
            settle(false);
            return;
          }
          gcLog(userId, 'resume: succeeded');
          const resumed = msg.payload as ResumedPayload;
          const peers = (resumed.existing_peers ?? []).filter((uid) => uid !== userId);
          this.callbacks?.onPeerSnapshot?.(peers);
          // Unlike 'joined' (which skips this when empty), always forward it
          // here even when empty: onSharingPeers' current UI-layer
          // implementation only ever unions IDs in, so an empty call is a
          // no-op today rather than a clear — but should the union ever
          // become a replace (matching its own doc comment), resume must
          // already be feeding it the authoritative current set.
          const sharingPeers = (resumed.sharing_peers ?? []).filter((uid) => uid !== userId);
          this.callbacks?.onSharingPeers?.(sharingPeers);
          this.ws = socket;
          // Replay anything that arrived while we didn't yet know this would
          // resolve as a resume, in the order it arrived, now that this.ws
          // correctly points here — before this point, an answer or ICE
          // candidate handleMessage tried to send would have silently found
          // this.ws still pointing at the OLD (dead) socket and gone nowhere.
          for (const queued of pending) void this.handleMessage(queued);
          socket.onmessage = (ev) => {
            if (this.ws !== socket) return;
            const m = JSON.parse(ev.data as string) as SignalingMessage;
            gcLog(userId, 'WS message', { type: m.type });
            void this.handleMessage(m);
          };
          socket.onclose = (ev) => {
            gcLog(userId, 'WS closed', { code: ev.code, reason: ev.reason });
            if (this.ws !== socket) return;
            if (this.reconnecting) return;
            if (this.inCall && !this.intentionalLeave) {
              void this.reconnect('ws_closed');
              return;
            }
            this.inCall = false;
            this.callbacks?.onCallEnded();
            this.teardown();
          };
          socket.onerror = () => {
            gcLog(userId, 'WS ERROR (resumed session)');
            if (this.ws !== socket) return;
            if (!this.reconnecting) this.callbacks?.onError('SFU connection failed');
          };
          settle(true);
          return;
        }
        if (msg.type === 'joined') {
          // The server fell back to a fresh join instead of resuming (token
          // expired mid-flight, grace window lapsed). This socket is now a
          // stranger's view of a brand-new participant slot we don't want —
          // abandon it and let the caller's own reconnect loop start clean.
          gcLog(userId, 'resume: server issued a fresh join instead of resuming');
          abandon();
          settle(false);
          return;
        }
        // An offer or ICE candidate can arrive interleaved before 'resumed' OR
        // 'joined' — queue it until we know which (see the comment on
        // `pending` above); handling it immediately, the way connectSignaling
        // does before 'joined', would be wrong here specifically because it
        // might turn out to belong to a fallback join instead.
        pending.push(msg);
      };

      socket.onclose = () => settle(false);
      socket.onerror = () => {
        gcLog(userId, 'resume: WS error');
        settle(false);
      };
    });
  }

  // Transport-only teardown for reconnect: closes PC/WS and clears remote
  // state, but keeps local capture (mic/camera/screen tracks, AudioContext,
  // noise cancellation) alive so rejoin doesn't re-prompt or rebuild audio.
  private partialTeardown(): void {
    if (this.ws) {
      // Detach handlers first — ws.close() must not trigger onclose teardown.
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    this.recovery?.cancel();
    this.recovery = null;
    this.stopQualitySampler();
    this.pc?.close();
    this.pc = null;
    // The new PC creates its own dummy tracks in createPeerConnection.
    this.dummyVideoTrack?.stop();
    this.dummyVideoTrack = null;
    this.dummyScreenVideoTrack?.stop();
    this.dummyScreenVideoTrack = null;
    this.releaseDummyScreenAudio();
    this.screenVideoSender = null; // belonged to the old PC
    this.screenAudioSender = null; // belonged to the old PC
    this.remoteStreams.clear();
    this.remoteScreenStreams.clear();
    this.pendingCandidates = [];
    this.inCall = false;
  }

  // VYC-76: fast uplink sampler, 500ms. Exists because the 3s pacing tick
  // measures only the AVERAGE rate and is blind to the failure we actually see.
  //
  // In the 2026-08-15 episodes the sick inbound track carried ~50 pps on
  // average while swinging 32–69 between ticks, i.e. the sender was emitting in
  // waves. Averaged over 3s that reads as a healthy 50 and the [35,70] guard
  // never fires. Sampling 6x faster and reporting the SPREAD (not the mean) is
  // what makes such a wave visible from the sending side.
  //
  // Deliberately sender-scoped rather than pc.getStats(): the microphone sender
  // is the only thing being judged here, and per-sender stats stay small as the
  // room grows.
  private startUplinkFastSampler(): void {
    this.stopUplinkFastSampler();
    this.uplinkPpsWindow = [];
    this.lastFastPacketsSent = 0;
    this.lastFastSampleAt = 0;
    this.uplinkFastIntervalId = setInterval(() => {
      void this.sampleUplinkFast();
    }, 500);
  }

  private stopUplinkFastSampler(): void {
    if (this.uplinkFastIntervalId !== null) {
      clearInterval(this.uplinkFastIntervalId);
      this.uplinkFastIntervalId = null;
    }
  }

  private async sampleUplinkFast(): Promise<void> {
    if (!this.pc || this.pc.connectionState !== 'connected') return;
    // The mic sender is the FIRST audio sender: transceiver slot [0] is the
    // microphone and slot [3] is screen-audio (see NewParticipantSession on the
    // server for the fixed ordering). Measuring screen-audio here would report
    // a dummy silent track's pacing instead of the voice we care about.
    const sender = this.pc.getSenders().find((s) => s.track?.kind === 'audio');
    if (!sender) return;
    try {
      const stats = await sender.getStats();
      let packetsSent = 0;
      stats.forEach((r) => {
        if (r.type === 'outbound-rtp' && (r as any).kind === 'audio') {
          packetsSent = ((r as any).packetsSent as number | undefined) ?? 0;
        }
      });
      const now = Date.now();
      if (this.lastFastSampleAt > 0 && packetsSent >= this.lastFastPacketsSent) {
        const dSec = (now - this.lastFastSampleAt) / 1000;
        if (dSec > 0.1) {
          const pps = (packetsSent - this.lastFastPacketsSent) / dSec;
          this.uplinkPpsWindow.push(pps);
          // Keep one 3s pacing window's worth, so the spread reported alongside
          // a pacing tick describes exactly that tick's interval.
          if (this.uplinkPpsWindow.length > 6) this.uplinkPpsWindow.shift();
        }
      }
      this.lastFastPacketsSent = packetsSent;
      this.lastFastSampleAt = now;
    } catch {
      // getStats throws on a closing pc — same handling as sampleQuality.
    }
  }

  private startQualitySampler(): void {
    this.stopQualitySampler();
    this.startUplinkFastSampler();
    this.lastBytesSent = 0;
    this.lastBytesSentAt = 0;
    // Reset the VYC-76 baselines too: a rejoin builds a new PeerConnection, so
    // its counters restart at zero and a stale baseline would report one huge
    // bogus negative delta on the first tick of every reconnect.
    this.lastPacingAt = 0;
    this.lastAudioPacketsSent = 0;
    this.lastPacketSendDelay = 0;
    this.lastSamplesDuration = 0;
    this.vyc76LastReportAt.clear();
    this.vyc76ReportCount = 0;
    this.lastIcePath = '';
    this.icePathChanges = 0;
    this.qualityIntervalId = setInterval(() => {
      void this.sampleQuality();
    }, 3000);
  }

  private stopQualitySampler(): void {
    this.stopUplinkFastSampler();
    if (this.qualityIntervalId !== null) {
      clearInterval(this.qualityIntervalId);
      this.qualityIntervalId = null;
    }
  }

  private async sampleQuality(): Promise<void> {
    if (!this.pc || this.pc.connectionState !== 'connected') {
      this.stopQualitySampler();
      return;
    }
    try {
      const stats = await this.pc.getStats();
      let lossPct = 0;
      let rttMs = 0;
      let hasData = false;
      let bytesSent = 0;
      let candidateRttMs = 0;
      // ── VYC-76 uplink diagnostics ────────────────────────────────────────
      // The reported bug ("one participant sounds sped up TO EVERYONE, a
      // rejoin fixes it") means the burst is created upstream of the SFU's
      // per-subscriber fan-out — so it must be visible here, on the
      // publisher's own send path. These three groups separate the candidates:
      //   mic/NC chain  → media-source.totalSamplesDuration vs wall clock
      //   encoder/pacer → outbound-rtp packet rate + totalPacketSendDelay
      //   transport     → candidate-pair protocol (TURN over TCP head-of-line
      //                   blocking stalls, then flushes a burst)
      let audioPacketsSent = 0;
      let totalPacketSendDelay = 0;
      let samplesDuration = 0;
      let selectedPairId = '';
      let localCandId = '';
      let remoteCandId = '';
      const candidates = new Map<string, RTCStats>();

      stats.forEach((report) => {
        if (report.type === 'remote-inbound-rtp' && report.kind === 'audio') {
          hasData = true;
          const fl = report.fractionLost as number | undefined;
          if (typeof fl === 'number') lossPct = Math.max(0, fl * 100);
          const rtt = report.roundTripTime as number | undefined;
          if (typeof rtt === 'number') rttMs = rtt * 1000;
        } else if (report.type === 'outbound-rtp' && !report.isRemote) {
          bytesSent += (report.bytesSent as number | undefined) ?? 0;
          if (report.kind === 'audio') {
            audioPacketsSent += ((report as any).packetsSent as number | undefined) ?? 0;
            totalPacketSendDelay += ((report as any).totalPacketSendDelay as number | undefined) ?? 0;
          }
        } else if (report.type === 'media-source' && (report as any).kind === 'audio') {
          samplesDuration = ((report as any).totalSamplesDuration as number | undefined) ?? 0;
        } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          const crtt = report.currentRoundTripTime as number | undefined;
          if (typeof crtt === 'number') candidateRttMs = crtt * 1000;
          // Prefer the nominated pair; fall back to any succeeded one.
          if (!selectedPairId || (report as any).nominated) {
            selectedPairId = report.id;
            localCandId = ((report as any).localCandidateId as string) ?? '';
            remoteCandId = ((report as any).remoteCandidateId as string) ?? '';
          }
        } else if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
          candidates.set(report.id, report);
        }
      });

      if (rttMs === 0 && candidateRttMs > 0) rttMs = candidateRttMs;

      this.logUplinkPacing({
        audioPacketsSent,
        totalPacketSendDelay,
        samplesDuration,
        localCand: candidates.get(localCandId),
        remoteCand: candidates.get(remoteCandId),
      });

      const now = Date.now();
      let bitrateKbps = 0;
      if (this.lastBytesSentAt > 0 && now > this.lastBytesSentAt) {
        const deltaBits = (bytesSent - this.lastBytesSent) * 8;
        const deltaSec = (now - this.lastBytesSentAt) / 1000;
        if (deltaSec > 0 && deltaBits >= 0) bitrateKbps = deltaBits / 1000 / deltaSec;
      }
      this.lastBytesSent = bytesSent;
      this.lastBytesSentAt = now;

      const metrics: ConnectionQualityMetrics = {
        level: computeQualityLevel(lossPct, rttMs, hasData),
        packetLoss: Math.round(lossPct * 10) / 10,
        rtt: Math.round(rttMs),
        bitrate: Math.round(bitrateKbps),
      };
      this.callbacks?.onLocalQuality?.(metrics);
    } catch {
      // getStats может кинуть на закрывающемся pc — игнорируем.
    }
  }

  // VYC-76: forwards one measured anomaly to GlitchTip, rate-limited.
  //
  // The console line is emitted by the caller either way; this only governs
  // what escapes the machine. Two limits, because the samplers tick every 2-3s
  // against every remote track: a per-kind cooldown so one sustained anomaly
  // reports once rather than continuously, and a per-call ceiling so a
  // persistently bad call cannot dominate the project's event quota.
  //
  // Every report carries selfUserId/peerUserId/roomId (first 8 chars — enough
  // to correlate, not enough to be an identifier on its own) so the listener's
  // report and the publisher's report can be joined against each other: that
  // join is the whole experiment, since it tells us whether the burst existed
  // before it reached the SFU.
  private reportVyc76(
    kind: string,
    message: string,
    extra: Record<string, unknown>,
    cooldownMs = 60_000,
  ): void {
    const MAX_PER_CALL = 10;
    if (this.vyc76ReportCount >= MAX_PER_CALL) return;
    const now = Date.now();
    const last = this.vyc76LastReportAt.get(kind) ?? 0;
    if (now - last < cooldownMs) return;
    this.vyc76LastReportAt.set(kind, now);
    this.vyc76ReportCount++;

    logger.report(
      message,
      { module: 'vyc76', kind, ...(typeof extra.path === 'string' ? { path: extra.path } : {}) },
      {
        ...extra,
        selfUserId: this.currentUserId.slice(0, 8),
        roomId: this.currentRoomId.slice(0, 8),
        elapsedFromJoinMs: this.joinedAt ? now - this.joinedAt : -1,
        reportIndexInCall: this.vyc76ReportCount,
      },
    );
  }

  // VYC-76: logs the publisher's own send pacing as per-tick deltas, so a stall
  // followed by a burst is visible as a rate spike. Cumulative totals cannot
  // show it. Each field isolates one layer of the send path:
  //
  //   samplesDurationDrift — wall-clock seconds elapsed minus seconds of audio
  //     the capture chain actually produced. Persistently negative means the
  //     mic → NC AudioContext → MediaStreamDestination chain is starving (the
  //     worklet underruns without ever catching up), so the encoder is fed less
  //     than real time. Near zero exonerates the capture chain.
  //
  //   pps — audio packets/sec leaving the encoder. Opus at 20ms ptime is 50.
  //     A tick near 0 followed by a tick well above 50 IS the burst, and proves
  //     it forms on this machine, before any packet reaches the SFU.
  //
  //   sendDelayMsPerPkt — totalPacketSendDelay delta / packets delta: how long
  //     each packet sat in the pacer/transport queue. Rises sharply when the
  //     transport backs up; the single clearest signal for TURN-over-TCP
  //     head-of-line blocking.
  //
  //   path — candidate types + protocol. `relay` with protocol `tcp`/`tls` is
  //     the configuration under suspicion (see TURN_URLS in .env.prod.example,
  //     which offers transport=tcp and turns:5349 alongside UDP).
  private logUplinkPacing(s: {
    audioPacketsSent: number;
    totalPacketSendDelay: number;
    samplesDuration: number;
    localCand?: RTCStats;
    remoteCand?: RTCStats;
  }): void {
    const now = Date.now();
    if (this.lastPacingAt > 0) {
      const dSec = (now - this.lastPacingAt) / 1000;
      const dPackets = s.audioPacketsSent - this.lastAudioPacketsSent;
      const dSendDelay = s.totalPacketSendDelay - this.lastPacketSendDelay;
      const dSamples = s.samplesDuration - this.lastSamplesDuration;
      const pps = dSec > 0 ? dPackets / dSec : 0;
      const sendDelayMsPerPkt = dPackets > 0 ? (dSendDelay / dPackets) * 1000 : -1;
      const local = s.localCand as any;
      const remote = s.remoteCand as any;
      const path =
        local || remote
          ? `${local?.candidateType ?? '?'}/${local?.relayProtocol ?? local?.protocol ?? '?'}` +
            ` → ${remote?.candidateType ?? '?'}/${remote?.protocol ?? '?'}`
          : 'unknown';
      // Spread across the 500ms samples inside this tick, computed ONLY over
      // samples that carry actual speech.
      //
      // The filter is not optional. When the speaker pauses, the rate collapses
      // toward comfort-noise levels, so a window straddling a speech boundary
      // mixes ~50 pps with near-zero and yields a spread near 2 — on every
      // sentence break, from a perfectly healthy sender. Unfiltered, this
      // detector would burn the 10-report budget within the first half-minute
      // of any call and never report the wave it exists to catch.
      //
      // 20 pps sits well below the ~50 of continuous speech and well above
      // comfort noise. The sick track's own low point was 32 pps, so a genuine
      // wave survives the filter intact.
      const SPEECH_PPS_FLOOR = 20;
      const win = this.uplinkPpsWindow.filter((p) => p >= SPEECH_PPS_FLOOR);
      let ppsMin = -1;
      let ppsMax = -1;
      let ppsSpread = -1;
      // Require most of the window to be speech: 3 of 6 surviving samples could
      // otherwise straddle a pause and still report a spread built from its edge.
      if (win.length >= 5) {
        ppsMin = Math.min(...win);
        ppsMax = Math.max(...win);
        const mean = win.reduce((a, b) => a + b, 0) / win.length;
        if (mean > 1) ppsSpread = (ppsMax - ppsMin) / mean;
      }

      const fields = {
        pps: pps.toFixed(1),
        ppsMin: ppsMin >= 0 ? ppsMin.toFixed(1) : 'N/A',
        ppsMax: ppsMax >= 0 ? ppsMax.toFixed(1) : 'N/A',
        ppsSpread: ppsSpread >= 0 ? ppsSpread.toFixed(2) : 'N/A',
        sendDelayMsPerPkt: sendDelayMsPerPkt >= 0 ? sendDelayMsPerPkt.toFixed(1) : 'N/A',
        samplesDurationDrift: (dSamples - dSec).toFixed(3),
        path,
        elapsedFromJoinMs: this.joinedAt ? now - this.joinedAt : -1,
      };

      // ── VYC-76: ICE path census ──────────────────────────────────────────
      // Two questions this answers, both needed BEFORE touching TURN_URLS:
      //
      //   1. How often does the selected pair move mid-call? A move to a TCP
      //      relay is the only звено in this setup that can hold packets back
      //      and then release them in a burst, which is what the receiving
      //      side measured. Counting the moves measures the actual cause.
      //
      //   2. Is a TCP relay ever someone's ONLY working path — i.e. would
      //      dropping transport=tcp from TURN_URLS cut them off entirely?
      //      A client that starts on relay/tcp and never leaves it is exactly
      //      that case. Without this census, removing TCP is a blind change.
      //
      // 'unknown' is skipped: getStats occasionally reports a succeeded pair
      // whose candidate rows haven't landed in the same snapshot, and treating
      // that as a transition would invent moves that never happened.
      if (path !== 'unknown') {
        if (this.lastIcePath === '') {
          this.lastIcePath = path;
          this.reportVyc76('ice-path-initial', 'VYC-76 ICE path selected', {
            path,
            isRelay: path.startsWith('relay'),
            isTcpRelay: path.startsWith('relay/tcp') || path.startsWith('relay/tls'),
          });
        } else if (path !== this.lastIcePath) {
          const from = this.lastIcePath;
          this.lastIcePath = path;
          this.icePathChanges++;
          gcLog(this.currentUserId, '[VYC-76] ICE PATH CHANGED', { from, to: path });
          // Shorter cooldown than the default: a call that flaps repeatedly is
          // the most informative case there is, and at 60s we would record one
          // move and silently drop the rest of the pattern.
          this.reportVyc76(
            'ice-path-change',
            'VYC-76 ICE path changed mid-call',
            {
              from,
              to: path,
              changeIndex: this.icePathChanges,
              toTcpRelay: path.startsWith('relay/tcp') || path.startsWith('relay/tls'),
              ...fields,
            },
            15_000,
          );
        }
      }
      // Two independent triggers, because they catch different failures:
      //
      //   rate  — mean outside [35,70]: a stall, or the burst draining it.
      //   spread — the 500ms samples inside this tick disagree by more than 60%
      //            of their mean. This is the one the old detector lacked. The
      //            sick track on 2026-08-15 averaged a healthy ~50 pps while
      //            swinging 32–69, so only the spread test can see it.
      //
      // 0.6 sits above ordinary DTX behaviour (speech onsets move the rate but
      // not that far within 3s) and well below the observed wave, whose spread
      // computes to roughly 0.7.
      const rateBad = pps < 35 || pps > 70;
      const spreadBad = ppsSpread >= 0.6;
      if (dSec > 0 && (rateBad || spreadBad)) {
        gcLog(this.currentUserId, '[VYC-76] UPLINK PACING ANOMALY', fields);
        this.reportVyc76('uplink-pacing', 'VYC-76 uplink pacing anomaly', {
          ...fields,
          trigger: spreadBad && rateBad ? 'rate+spread' : spreadBad ? 'spread' : 'rate',
          ppsNum: Number(pps.toFixed(1)),
          ppsMinNum: ppsMin,
          ppsMaxNum: ppsMax,
          ppsSpreadNum: ppsSpread,
          sendDelayMsPerPktNum: sendDelayMsPerPkt,
          samplesDurationDriftNum: dSamples - dSec,
          tickSec: dSec,
        });
      } else {
        gcLog(this.currentUserId, '[VYC-76] uplink pacing', fields);
      }
    }
    this.lastPacingAt = now;
    this.lastAudioPacketsSent = s.audioPacketsSent;
    this.lastPacketSendDelay = s.totalPacketSendDelay;
    this.lastSamplesDuration = s.samplesDuration;
  }

  private restoreScreenShare(screenTrack: MediaStreamTrack | null): void {
    if (!screenTrack) return;
    if (screenTrack.readyState !== 'live') {
      // The OS 'ended' handler may have already stopped the share during the
      // outage (stopScreenShare sets _isScreenSharing = false) — don't double-fire.
      if (!this._isScreenSharing) return;
      // The OS capture died during the outage — drop share state honestly.
      gcLog(this.currentUserId, 'reconnect: screen track dead, stopping share');
      this._isScreenSharing = false;
      this.screenStream?.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
      this.callbacks?.onScreenShareEnded?.();
      return;
    }
    this.pendingScreenRestore = screenTrack;
    // The PC may already exist: the server's offer often precedes 'joined'.
    this.applyScreenRestore();
  }

  // Re-attaches the pending screen video track (and, if present, the screen
  // audio track already flowing through this.screenStream) to the new PC's
  // dedicated screen senders. Also called after each answer in handleOffer: if
  // 'joined' resolved before the first offer, the PC doesn't exist yet when
  // restoreScreenShare runs.
  private applyScreenRestore(): void {
    const track = this.pendingScreenRestore;
    if (!track || !this.screenVideoSender) return;
    this.pendingScreenRestore = null;

    const audioTrack = this.screenStream?.getAudioTracks()[0] ?? null;

    Promise.all([
      this.screenVideoSender.replaceTrack(track),
      audioTrack && this.screenAudioSender ? this.screenAudioSender.replaceTrack(audioTrack) : Promise.resolve(),
    ]).then(() => {
      // Same reasoning as startScreenShare: replaceTrack doesn't renegotiate,
      // the SFU needs an explicit keyframe push.
      this.requestKeyframeWithRetry();
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'screen_share_start', payload: { track_id: track.id } }));
      }
      // Re-announce over the app WS too: our outage cleared everyone else's
      // screenSharers state, and screen_share_start above never leaves the SFU.
      this.callbacks?.onScreenShareRestored?.();
      gcLog(this.currentUserId, 'reconnect: screen share restored');
    }).catch((err) => {
      gcLog(this.currentUserId, 'reconnect: screen restore failed', { error: String(err) });
    });
  }

  // ── Controls ───────────────────────────────────────────────────────────────

  toggleMuteAudio(): boolean {
    const t = this.localStream?.getAudioTracks()[0];
    if (!t || !this.localStream) return false;
    this.micMuted = !this.micMuted;
    const handledByChain = noiseCancellationService.setMicMuted(this.localStream.id, this.micMuted);
    if (!handledByChain) {
      // No NC chain for this stream (e.g. Web Audio unsupported) — fall back
      // to muting the track itself, the same mechanism used before this
      // feature existed.
      t.enabled = !this.micMuted;
    }
    return this.micMuted;
  }

  toggleMuteVideo(): boolean {
    const t = this.localStream?.getVideoTracks()[0];
    if (!t) return false;
    t.enabled = !t.enabled;
    return !t.enabled; // true = video off
  }

  // Subscribes to targetUserId's screen-share video/audio, if they're
  // currently sharing. No-op if the SFU connection isn't open (e.g. mid-reconnect —
  // the reconnect path resubscribes on its own, see reconnect()).
  watchShare(targetUserId: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'watch_share', payload: { target_user_id: targetUserId } }));
  }

  unwatchShare(targetUserId: string): void {
    // Drop the cached screen stream unconditionally (even if the socket is
    // already gone): the SFU detaches its senders, so this object is stale. A
    // later re-subscribe must start from a fresh MediaStream — otherwise the
    // UI's `el.srcObject !== screenStream` guard can mistake the stale object
    // for "already attached" and never re-attach the new tracks.
    this.remoteScreenStreams.delete(targetUserId);
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'unwatch_share', payload: { target_user_id: targetUserId } }));
  }

  // ── Screen sharing ─────────────────────────────────────────────────────────

  // Starts screen sharing by replacing the video sender's track with a screen capture track.
  // sourceId: desktopCapturer source ID (Electron). Pass undefined to use native getDisplayMedia picker.
  // quality: resolution preset; defaults to 1080p. Uses ideal/max constraints so the browser
  //          falls back to the closest available resolution instead of failing.
  async startScreenShare(sourceId?: string, quality: ScreenQuality = '1080p'): Promise<void> {
    if (!this.pc || !this.inCall) throw new Error('Not in a call');
    if (this._isScreenSharing) await this.stopScreenShare();

    const preset = SCREEN_QUALITY_PRESETS[quality];
    let stream: MediaStream;

    if (sourceId) {
      // Electron: getUserMedia with chromeMediaSource mandatory constraints.
      // max* caps the resolution; min* sets a floor so the call doesn't fail if the source
      // is smaller than requested (e.g. a small window at 2K preset).
      const videoConstraints = {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: preset.width,
          maxHeight: preset.height,
          maxFrameRate: preset.frameRate,
          minWidth: 640,
          minHeight: 360,
        },
      };
      try {
        // Also request desktop audio loopback (default output device). Only
        // reliably available on Windows/macOS 13+, and typically only when
        // sharing a whole screen rather than a single window. The mandatory
        // constraint throws for the WHOLE getUserMedia call — including the
        // video half — on unsupported combinations, so a failure here must
        // fall back to video-only rather than aborting the share entirely.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
            },
          },
          video: videoConstraints,
        } as unknown as MediaStreamConstraints);
      } catch (err) {
        gcLog(this.currentUserId, 'screen capture with audio failed, retrying video-only', { error: String(err) });
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: videoConstraints,
        } as unknown as MediaStreamConstraints);
      }
    } else {
      // Browser fallback: native OS picker with ideal constraints.
      // ideal lets the browser pick the closest resolution; max prevents upscaling.
      // audio: true surfaces the OS picker's "share audio" checkbox where the
      // browser supports it (e.g. Windows/ChromeOS Chrome); on platforms
      // without support the returned stream just has no audio track — no
      // exception is thrown per spec, so no fallback is needed here.
      stream = await (navigator.mediaDevices as MediaDevices & {
        getDisplayMedia(c: Record<string, unknown>): Promise<MediaStream>;
      }).getDisplayMedia({
        audio: true,
        video: {
          width:     { ideal: preset.width,     max: preset.width },
          height:    { ideal: preset.height,    max: preset.height },
          frameRate: { ideal: preset.frameRate, max: preset.frameRate },
        },
      });
    }

    const screenTrack = stream.getVideoTracks()[0];
    if (!screenTrack) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('Screen stream has no video track');
    }

    // Tell the SFU the wire ID of the upcoming screen video track BEFORE it starts
    // flowing (replaceTrack below makes RTP begin). The server marks this track id
    // as RoleScreen, so even a client that negotiates the screen video onto the
    // camera m-line is still recognized as a screen share by the viewer.
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'screen_share_start', payload: { track_id: screenTrack.id } }));
    }

    // Chrome treats screen-capture tracks as 'detail' content by default and,
    // when constrained by bandwidth or CPU, keeps resolution while dropping
    // framerate — the share stays sharp but turns into a few-fps slideshow.
    // 'motion' flips that trade-off: keep framerate, degrade resolution.
    screenTrack.contentHint = 'motion';

    // Log requested vs actual resolution so we can diagnose fallback behaviour.
    const actual = screenTrack.getSettings();
    gcLog(this.currentUserId, 'screen share track settings', {
      quality,
      requested: { width: preset.width, height: preset.height, frameRate: preset.frameRate },
      actual:    { width: actual.width,  height: actual.height,  frameRate: actual.frameRate },
    });

    if (!this.screenVideoSender) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('No dedicated screen-video sender on peer connection');
    }

    // When the user stops sharing via the OS UI (e.g. Chrome's "Stop sharing" bar),
    // the browser fires 'ended' on the capture track. Mirror that into our state.
    screenTrack.onended = () => {
      gcLog(this.currentUserId, 'screen track ended by OS/user');
      void this.stopScreenShare();
      this.callbacks?.onScreenShareEnded?.();
    };

    await this.screenVideoSender.replaceTrack(screenTrack);
    screenTrack.enabled = true;

    await this.applyScreenShareEncoding(this.screenVideoSender, preset.maxBitrate);

    this.screenStream = stream;
    this._isScreenSharing = true;

    // Mix captured system/desktop audio (if any) into the existing outgoing
    // audio track via Web Audio — no SFU/protocol changes needed. Silently
    // skipped if the platform gave no audio track, or if there's no NC chain
    // to mix into (e.g. this participant joined without a microphone).
    //
    // Before mixing, run it through AEC3 (referenceBus = current remote
    // participants' audio) so a loopback capture of the call itself doesn't
    // get echoed back to everyone as duplicated voices. attachEchoCancellation
    // returns null on any init failure — falls back to the raw track exactly
    // like before this was added.
    const systemAudioTrack = stream.getAudioTracks()[0];
    if (systemAudioTrack && this.screenAudioSender) {
      echoCancellationService.ensureReferenceBus();
      for (const [userId, remoteStream] of this.remoteStreams) {
        const remoteAudioTrack = remoteStream.getAudioTracks()[0];
        if (remoteAudioTrack) echoCancellationService.addReferenceTrack(userId, remoteAudioTrack);
      }
      const aecHandle = await echoCancellationService.attachEchoCancellation(systemAudioTrack);

      // stopScreenShare()/teardown() may have run to completion while the AEC
      // init above was in flight (e.g. the OS "Stop sharing" bar firing
      // screenTrack.onended → stopScreenShare, or a rapid second start/stop
      // from the UI). If so, this invocation is stale: replacing the sender's
      // track now would resurrect system audio after the user already stopped
      // sharing. Discard it instead.
      if (!this._isScreenSharing || this.screenStream !== stream) {
        aecHandle?.detach();
        gcLog(this.currentUserId, 'screen share audio', {
          captured: true,
          sent: false,
          echoCancelled: false,
          discardedStale: true,
        });
      } else {
        this.screenAecDetach = aecHandle?.detach ?? null;
        const audioForSend = aecHandle?.track ?? systemAudioTrack;
        await this.screenAudioSender.replaceTrack(audioForSend);
        gcLog(this.currentUserId, 'screen share audio', {
          captured: true,
          sent: true,
          echoCancelled: aecHandle !== null,
        });
      }
    } else {
      gcLog(this.currentUserId, 'screen share audio', { captured: false });
    }

    // replaceTrack doesn't renegotiate, so the SFU has no other signal that the
    // video content just changed. Explicitly ask it to force a keyframe — without
    // this, recovery depends entirely on a viewer's decoder noticing a bad frame
    // and requesting its own PLI, which is unreliable right at the switch and was
    // the cause of intermittent black screens for viewers when sharing started.
    // Retry because OnTrack on the SFU side may not have fired yet (first RTP
    // packet hasn't arrived); retries at 200ms and 800ms cover that window.
    this.requestKeyframeWithRetry();

    gcLog(this.currentUserId, 'screen share started', { sourceId: sourceId?.slice(0, 16) ?? 'getDisplayMedia', quality });
  }

  // Asks the SFU to force a fresh keyframe for our published video track.
  // Used after replaceTrack (screen share start/stop) since that swap doesn't
  // trigger renegotiation and the server otherwise has no way to know the
  // encoded content changed.
  private requestKeyframe(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'request_keyframe', payload: {} }));
    }
  }

  // Sends request_keyframe with retries to cover a timing race: the SFU's
  // OnTrack may not have fired yet when the first request arrives (replaceTrack
  // starts sending RTP, but the first packet takes ~50-100ms to reach pion).
  // The server now also retries internally (500ms), so these client retries are
  // a belt-and-suspenders measure for slow networks or high-load scenarios.
  private requestKeyframeWithRetry(): void {
    this.requestKeyframe();
    setTimeout(() => { this.requestKeyframe(); }, 200);
    setTimeout(() => { this.requestKeyframe(); }, 800);
  }

  // Applies (maxBitrate set) or clears (maxBitrate null) screen-share encoder
  // settings on the video sender. degradationPreference is the spec-level way to
  // ask for framerate-over-resolution; Chrome largely decides from
  // track.contentHint instead, so both are set. Failure is non-fatal — the share
  // still runs, just on default encoder settings.
  private async applyScreenShareEncoding(sender: RTCRtpSender, maxBitrate: number | null): Promise<void> {
    try {
      const params = sender.getParameters() as RTCRtpSendParameters & {
        degradationPreference?: 'maintain-framerate' | 'maintain-resolution' | 'balanced';
      };
      params.degradationPreference = maxBitrate !== null ? 'maintain-framerate' : undefined;
      // setParameters can only modify existing encodings, never add them; the list
      // can be empty until the first negotiation completes.
      for (const enc of params.encodings ?? []) {
        if (maxBitrate !== null) {
          enc.maxBitrate = maxBitrate;
        } else {
          delete enc.maxBitrate;
        }
      }
      await sender.setParameters(params);
      gcLog(this.currentUserId, 'screen share encoding applied', {
        maxBitrate,
        degradationPreference: params.degradationPreference ?? 'default',
        encodings: params.encodings?.length ?? 0,
      });
    } catch (err) {
      gcLog(this.currentUserId, 'screen share encoding setParameters failed', { error: String(err) });
    }
  }

  async stopScreenShare(): Promise<void> {
    if (!this._isScreenSharing) return;

    this._isScreenSharing = false;

    if (this.screenVideoSender) {
      await this.screenVideoSender.replaceTrack(null).catch((err) => {
        gcLog(this.currentUserId, 'stopScreenShare replaceTrack error', { error: String(err) });
      });
      // Lift the screen-share bitrate cap and degradation preference off the
      // sender.
      await this.applyScreenShareEncoding(this.screenVideoSender, null);
    }
    if (this.screenAudioSender) {
      await this.screenAudioSender.replaceTrack(null).catch((err) => {
        gcLog(this.currentUserId, 'stopScreenShare audio replaceTrack error', { error: String(err) });
      });
    }

    this.screenAecDetach?.();
    this.screenAecDetach = null;
    echoCancellationService.teardownReferenceBus();

    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'screen_share_stop', payload: {} }));
    }

    // The camera slot was never touched by screen sharing (dedicated senders
    // now), so no keyframe push is needed there. The screen-video slot going
    // to a null track needs no keyframe either — there's nothing left to decode.

    gcLog(this.currentUserId, 'screen share stopped');
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  get isInGroupCallState(): boolean { return this.inCall; }
  get currentRoomIdState(): string { return this.currentRoomId; }
  get localStreamState(): MediaStream | null { return this.localStream; }
  get screenStreamState(): MediaStream | null { return this.screenStream; }
  get isScreenSharing(): boolean { return this._isScreenSharing; }
  get isMicrophoneAvailable(): boolean { return this._microphoneAvailable; }
  get peerCount(): number { return this.remoteStreams.size; }

  // ── Private: media acquisition ────────────────────────────────────────────

  // Creates a muted, zero-fps canvas video track used as a placeholder sender track
  // when the machine has no camera.
  //
  // Why not a trackless addTransceiver('video', sendrecv)?  Per JSEP §5.10 Chrome
  // associates only addTrack-created transceivers with the recvonly m-sections of the
  // server's offer.  A trackless addTransceiver stays unassociated (mid=null), the
  // answer's video section becomes a=inactive with no a=ssrc, and a later
  // replaceTrack(screenTrack) sends zero RTP — remote users see a black screen.
  // pion also can't bind an unsignaled SSRC for non-simulcast tracks, so the SSRC
  // must be in the answer SDP.
  //
  // captureStream(0) produces no frames (frames appear only on requestFrame(), which
  // is never called), so no RTP flows until screen sharing replaces this track.
  private createDummyVideoTrack(): MediaStreamTrack {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    canvas.getContext('2d')?.fillRect(0, 0, 16, 16);
    const track = canvas.captureStream(0).getVideoTracks()[0];
    track.enabled = false;
    return track;
  }

  // Creates a silent placeholder track for the screen-audio sender slot, so its
  // SSRC is already established in the very first SDP (mirrors
  // createDummyVideoTrack's reasoning). Unlike video, a Web Audio track can't
  // emit literally zero frames — audio nodes always run continuous blocks — so
  // this dummy does send a low-volume, always-silent RTP stream from join
  // onward. That's fine: the server treats "is sharing active" as an explicit
  // flag (screen_share_start/stop), never as "does this slot carry RTP".
  private createDummyAudioTrack(): MediaStreamTrack {
    // Defensive: never let a previous PC's context survive into a new one.
    this.releaseDummyScreenAudio();
    const ctx = new AudioContext();
    this.dummyScreenAudioContext = ctx;
    const destination = ctx.createMediaStreamDestination();
    const track = destination.stream.getAudioTracks()[0];
    this.dummyScreenAudioTrack = track;
    return track;
  }

  // Stopping the screen-audio placeholder track and closing its AudioContext.
  // close() is a Promise — fire-and-forget, teardown must not block on it.
  private releaseDummyScreenAudio(): void {
    this.dummyScreenAudioTrack?.stop();
    this.dummyScreenAudioTrack = null;
    this.dummyScreenAudioContext?.close().catch(() => {});
    this.dummyScreenAudioContext = null;
  }

  // Creates a running-silent audio track to fill the mic slot when the user has
  // no microphone. Distinct from the screen-audio dummy so the two slots never
  // share a track object.
  private createMicDummyAudioTrack(): MediaStreamTrack {
    this.releaseMicDummyAudio();
    const ctx = new AudioContext();
    this.dummyMicAudioContext = ctx;
    const destination = ctx.createMediaStreamDestination();
    const track = destination.stream.getAudioTracks()[0];
    this.dummyMicAudioTrack = track;
    return track;
  }

  private releaseMicDummyAudio(): void {
    this.dummyMicAudioTrack?.stop();
    this.dummyMicAudioTrack = null;
    this.dummyMicAudioContext?.close().catch(() => {});
    this.dummyMicAudioContext = null;
  }

  private async acquireMedia(): Promise<MediaStream | null> {
    const audioConstraints = MIC_AUDIO_CONSTRAINTS;
    gcLog(this.currentUserId, 'getUserMedia constraints', { audio: audioConstraints });
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: true });
    } catch { /* try next */ }
    try {
      // Fall back to audio-only if camera is unavailable.
      return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
    } catch { /* try next */ }
    try {
      // No audio device — try video-only.
      gcLog(this.currentUserId, 'no audio device, trying video-only');
      return await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    } catch { /* try next */ }
    gcLog(this.currentUserId, 'no media devices available, joining without local media');
    return null;
  }

  // ── Private: mic-device watch (see the field block for the why) ────────────

  // Identity of the OS-default mic: the 'default' entry's label/groupId change
  // even when Chrome migrates the live track silently.
  private async defaultMicSignature(): Promise<string> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === 'audioinput');
      if (inputs.length === 0) return 'none';
      // No inputs[0] fallback: enumeration order shifts with unrelated devices
      // and would fake migrations in non-Chromium builds (no 'default' entry).
      const def = inputs.find((d) => d.deviceId === 'default');
      return def ? `${def.deviceId}|${def.groupId}|${def.label}` : 'no-default-entry';
    } catch {
      return 'unknown';
    }
  }

  private startMicWatch(baselineSig: string): void {
    this.stopMicWatch();
    if (!this.localStream || this.localStream.getAudioTracks().length === 0) return;
    this.micDeviceSignature = baselineSig;
    navigator.mediaDevices?.addEventListener('devicechange', this.onDeviceChange);
    // devicechange doesn't fire when the default moves between already-present
    // devices — the poll covers that, plus a dead raw track.
    this.micWatchIntervalId = setInterval(() => void this.checkMicMigration('poll'), 5000);
  }

  private stopMicWatch(): void {
    if (this.micWatchIntervalId !== null) {
      clearInterval(this.micWatchIntervalId);
      this.micWatchIntervalId = null;
    }
    if (this.micWatchDebounceId !== null) {
      clearTimeout(this.micWatchDebounceId);
      this.micWatchDebounceId = null;
    }
    navigator.mediaDevices?.removeEventListener('devicechange', this.onDeviceChange);
    this.micDeviceSignature = '';
  }

  private async checkMicMigration(trigger: string): Promise<void> {
    if (this.micRebuildInFlight || !this.localStream) return;
    if (Date.now() < this.micRebuildBlockedUntil) return;
    const epoch = this.sessionEpoch;
    const stream = this.localStream;
    const sig = await this.defaultMicSignature();
    if (epoch !== this.sessionEpoch || this.localStream !== stream) return;
    // Sentinel: nothing to compare or rebuild onto (no mic / enumeration failed).
    if (MIC_SIG_SENTINELS.has(sig)) return;
    const raw = noiseCancellationService.getRawAudioTrack(stream.id);
    const rawDead = raw !== null && raw.readyState !== 'live';
    const sigChanged =
      !MIC_SIG_SENTINELS.has(this.micDeviceSignature) && sig !== this.micDeviceSignature;
    if (!sigChanged && !rawDead) return;
    const settings = raw?.getSettings();
    // Full identity (labels carry personal device names) stays local-only.
    gcLog(this.currentUserId, 'mic device migrated — rebuilding capture chain', {
      trigger,
      sigChanged,
      rawDead,
      from: this.micDeviceSignature,
      to: sig,
      rawLabel: raw?.label ?? null,
      rawReadyState: raw?.readyState ?? null,
      rawSettings: settings ?? null,
      chainCtxState: noiseCancellationService.getChainContextState(stream.id),
    });
    this.reportVyc76('mic-migrated', 'Mic device migrated mid-call', {
      trigger,
      sigChanged,
      rawDead,
      fromSig: sigDigest(this.micDeviceSignature),
      toSig: sigDigest(sig),
      rawReadyState: raw?.readyState ?? null,
      rawSampleRate: settings?.sampleRate ?? null,
      rawChannelCount: settings?.channelCount ?? null,
      chainCtxState: noiseCancellationService.getChainContextState(stream.id),
    }, 10_000);
    await this.rebuildMicPipeline(trigger, sig);
  }

  // Rebuilds the capture against the CURRENT default device: fresh gUM, fresh
  // NC chain, replaceTrack on the live sender — a rejoin's cure without the rejoin.
  private async rebuildMicPipeline(trigger: string, newSig: string): Promise<void> {
    if (this.micRebuildInFlight) return;
    const oldStream = this.localStream;
    const oldAudio = oldStream?.getAudioTracks()[0];
    if (!oldStream || !oldAudio) return;
    this.micRebuildInFlight = true;
    const myToken = ++this.micRebuildToken;
    const epoch = this.sessionEpoch;
    let rawAudio: MediaStream | null = null;
    let rebuilt: MediaStream | null = null;
    let swapped = false;
    try {
      rawAudio = await navigator.mediaDevices.getUserMedia({ audio: MIC_AUDIO_CONSTRAINTS });
      if (epoch !== this.sessionEpoch || this.localStream !== oldStream) {
        rawAudio.getTracks().forEach((t) => t.stop());
        return;
      }
      rebuilt = await noiseCancellationService.createChain(rawAudio);
      const newAudio = rebuilt.getAudioTracks()[0];
      if (epoch !== this.sessionEpoch || this.localStream !== oldStream || !newAudio) {
        return; // finally-block cleanup releases the fresh chain
      }
      // Mute BEFORE the sender swap — no leaked syllable between replaceTrack
      // and a later gain change. Same semantics as toggleMuteAudio.
      if (!noiseCancellationService.setMicMuted(rebuilt.id, this.micMuted)) {
        newAudio.enabled = !this.micMuted;
      }
      // Same-kind swap on the live sender; during a reconnect window pc is
      // null and the coming createPeerConnection re-adds from localStream.
      const sender = this.pc?.getSenders().find((s) => s.track === oldAudio);
      if (sender) await sender.replaceTrack(newAudio);
      if (epoch !== this.sessionEpoch || this.localStream !== oldStream) {
        return;
      }
      // Camera tracks move over as-is (same objects — enabled state survives).
      oldStream.getVideoTracks().forEach((t) => rebuilt!.addTrack(t));

      this.localStream = rebuilt;
      this.micDeviceSignature = newSig;
      this.micRebuildCount++;
      swapped = true;
      // Re-assert AFTER the swap: a toggle during the replaceTrack await landed
      // on the OLD chain — losing it would leave a hot mic behind a muted UI.
      if (!noiseCancellationService.setMicMuted(rebuilt.id, this.micMuted)) {
        newAudio.enabled = !this.micMuted;
      }
      this.micRebuildFailures = 0;
      this.micRebuildBlockedUntil = Date.now() + (this.micRebuildCount >= 5 ? 300_000 : 15_000);

      noiseCancellationService.releaseChain(oldStream.id);
      oldAudio.stop();

      const newRaw = noiseCancellationService.getRawAudioTrack(rebuilt.id);
      const newSettings = newRaw?.getSettings();
      // Full identity (labels carry personal device names) stays local-only.
      gcLog(this.currentUserId, 'mic capture chain rebuilt', {
        trigger,
        rebuildIndex: this.micRebuildCount,
        senderSwapped: sender != null,
        newRawLabel: newRaw?.label ?? null,
        newRawSettings: newSettings ?? null,
      });
      this.reportVyc76('mic-rebuilt', 'Mic capture chain rebuilt mid-call', {
        trigger,
        rebuildIndex: this.micRebuildCount,
        senderSwapped: sender != null,
        toSig: sigDigest(newSig),
        newRawSampleRate: newSettings?.sampleRate ?? null,
        newRawChannelCount: newSettings?.channelCount ?? null,
      }, 10_000);
    } catch (err) {
      if (epoch === this.sessionEpoch && this.localStream === oldStream) {
        // Keep the old chain — degraded audio beats no audio; the next
        // devicechange/poll tick past the backoff window retries.
        this.micRebuildFailures++;
        this.micRebuildBlockedUntil =
          Date.now() + Math.min(30_000 * 2 ** (this.micRebuildFailures - 1), 300_000);
        gcLog(this.currentUserId, 'mic rebuild FAILED, keeping old chain', {
          trigger,
          failureIndex: this.micRebuildFailures,
          error: String(err),
        });
        this.reportVyc76('mic-rebuild-failed', 'Mic capture chain rebuild failed', {
          trigger,
          error: String(err),
        });
      } else {
        // Stale invocation settling after its call ended must not poison the
        // successor call's damping or report budget.
        gcLog(this.currentUserId, 'stale mic rebuild settled after its call ended', {
          trigger,
          error: String(err),
        });
      }
    } finally {
      if (!swapped) {
        if (rebuilt) {
          // Bailed/threw after the fresh chain existed: dismantle it (audio
          // only — camera tracks attach only once the swap commits).
          noiseCancellationService.releaseChain(rebuilt.id);
          rebuilt.getAudioTracks().forEach((t) => t.stop());
        }
        // A chainless bail (createChain rejected) must still release the mic;
        // double-stop is a no-op.
        rawAudio?.getAudioTracks().forEach((t) => t.stop());
      }
      if (this.micRebuildToken === myToken) {
        this.micRebuildInFlight = false;
      }
    }
  }

  // ── Private: signaling connection ─────────────────────────────────────────

  // Establishes signaling and (via the server's offer) a new PC. Shared by the
  // initial join and reconnect. Fetches ICE servers every time: TURN entries
  // carry ephemeral credentials that may have expired during a network outage.
  private async connect(roomId: string, userId: string): Promise<boolean> {
    this.iceServers = await getIceServers();
    gcLog(userId, 'ICE servers', {
      urls: this.iceServers.flatMap((s) => s.urls),
      hasTurn: this.iceServers.some((s) => String(s.urls).startsWith('turn')),
    });
    return this.connectSignaling(roomId, userId);
  }

  private async connectSignaling(roomId: string, userId: string): Promise<boolean> {
    // Room-scoped token minted by the API on every attempt (not cached): it
    // proves server/channel membership to the SFU, which otherwise only
    // knows the caller holds *some* valid Vycord session — see
    // docs/superpowers/specs/2026-08-04-private-channels-design.md. A VYC-24
    // reconnect may also run after the user re-logged in, so a token frozen
    // at join time would be stale regardless.
    // Snapshot at entry: identifies which join/reconnect cycle this attempt
    // belongs to. getVoiceToken() below is the first await, so a fresher
    // doJoinGroupCall() can bump sessionEpoch while we're mid-fetch — checked
    // right after. Without this, a stale reconnect attempt that started
    // before a manual rejoin could still finish setting up after it, clobber
    // `this.ws` with a socket nobody's listening for the result of, and fire
    // a spurious onError onto the meanwhile-already-healthy call.
    const mySession = this.sessionEpoch;

    let token: string;
    try {
      const resp = await apiService.getVoiceToken(roomId);
      token = resp.token;
    } catch (err) {
      gcLog(userId, 'failed to obtain voice token', { error: String(err) });
      if (!this.reconnecting && mySession === this.sessionEpoch) this.callbacks?.onError(apiErrorText(err, t));
      return false;
    }

    if (mySession !== this.sessionEpoch) {
      gcLog(userId, 'connectSignaling: superseded before WS open, aborting');
      return false;
    }

    const url = `${SFU_URL}/ws?room_id=${encodeURIComponent(roomId)}&token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(url);
    this.ws = socket;

    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const settle = (v: boolean) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(connectTimeout);
        resolve(v);
      };

      // Guarantees this attempt's promise always settles even if the WS never
      // opens or hangs without close/error firing (seen on some mobile networks
      // and VPN transitions) — otherwise the reconnect loop stalls forever on
      // this attempt instead of moving on to the next delay.
      const connectTimeout = setTimeout(() => {
        if (resolved) return;
        gcLog(userId, 'WS connect timeout');
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        socket.close();
        if (this.ws === socket) this.ws = null;
        if (!this.reconnecting && mySession === this.sessionEpoch) this.callbacks?.onError('SFU connection timeout');
        settle(false);
      }, 10_000);

      // All handlers close over `socket` and bail when `this.ws` has moved on
      // to a newer socket. Without the identity check, a late event from a
      // stale socket (e.g. the server evicting our old session after a rejoin)
      // mutates shared state or — worst case — onclose fires reconnect(),
      // whose partialTeardown closes the CURRENT healthy socket, kicking us
      // out of a perfectly working call.
      socket.onopen = () => {
        gcLog(userId, 'WS connected', { roomId });
        // The server creates the PC on its side upon WS upgrade — no explicit join message needed.
        // The server will immediately send us an "offer".
      };

      socket.onmessage = (e) => {
        if (this.ws !== socket) return; // stale socket — not ours anymore
        const msg = JSON.parse(e.data as string) as SignalingMessage;
        gcLog(userId, 'WS message', { type: msg.type });
        if (msg.type === 'joined') {
          this.inCall = true;
          this.joinedAt = Date.now();
          const joined = msg.payload as JoinedPayload;
          gcLog(userId, 'joined room', { existingPeers: joined.existing_peers ?? [] });
          this.resumeToken = joined.resume_token ?? null;
          // Notify the UI about participants who are already in the room.
          // Stale self entry may be present during reconnect: the server snapshots
          // existing peers before evicting our old session, so it can still include us —
          // rendering that would create a ghost self-tile.
          const peers = (joined.existing_peers ?? []).filter((uid) => uid !== userId);
          peers.forEach((uid) => this.callbacks?.onPeerJoined(uid, 'snapshot'));
          // Let the UI learn about already-active screen shares from the SFU
          // snapshot (filter out a stale self entry the same way as existing_peers).
          // network reconnects re-fire 'joined', which re-delivers the authoritative
          // share state — rebuilding the Watch button the broadcast miss erased.
          const sharingPeers = (joined.sharing_peers ?? []).filter((uid) => uid !== userId);
          if (sharingPeers.length > 0) this.callbacks?.onSharingPeers?.(sharingPeers);
          socket.onmessage = (ev) => {
            if (this.ws !== socket) return;
            const m = JSON.parse(ev.data as string) as SignalingMessage;
            gcLog(userId, 'WS message', { type: m.type });
            void this.handleMessage(m);
          };
          settle(peers.length === 0);
        } else {
          // Server may send an offer before 'joined' arrives — handle immediately.
          void this.handleMessage(msg);
        }
      };

      socket.onclose = (ev) => {
        gcLog(userId, 'WS closed', { code: ev.code, reason: ev.reason });
        settle(false);
        if (this.ws !== socket) return; // stale socket — must not touch the live call
        if (this.reconnecting) return; // reconnect loop owns the lifecycle
        if (this.inCall && !this.intentionalLeave) {
          void this.reconnect('ws_closed');
          return;
        }
        this.inCall = false;
        this.callbacks?.onCallEnded();
        this.teardown();
      };

      socket.onerror = () => {
        gcLog(userId, 'WS ERROR');
        settle(false);
        if (this.ws !== socket) return;
        if (!this.reconnecting) this.callbacks?.onError('SFU connection failed');
      };
    });
  }

  // ── Private: PeerConnection creation ─────────────────────────────────────

  private createPeerConnection(): RTCPeerConnection {
    this.pcCreatedAt = Date.now();
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    // One ladder per PeerConnection: it holds timers that must not outlive the PC
    // they were started for.
    this.recovery = new ConnectionRecovery({
      // The SFU is the offerer, so the restart has to be asked for over signaling
      // rather than performed locally. No socket, no restart — the ladder then
      // skips straight to a rejoin.
      requestIceRestart: () => {
        if (this.ws?.readyState !== WebSocket.OPEN) return false;
        this.ws.send(JSON.stringify({ type: 'request_ice_restart', payload: {} }));
        return true;
      },
      fullReconnect: () => {
        void this.reconnect('pc_disconnected_ladder');
      },
      isConnected: () => this.pc?.connectionState === 'connected',
      onStep: (step) => {
        gcLog(this.currentUserId, 'recovery step', { step, state: this.pc?.connectionState ?? 'no-pc' });
      },
    });

    // Add local tracks before the first offer arrives.
    // pion sends a server-initiated offer with recvonly m-sections (one per track).
    // Chrome matches these pre-created sendrecv transceivers to the offer's recvonly
    // m-sections by codec kind. Because addTrack assigns SSRCs immediately, the
    // answer SDP includes a=ssrc lines — pion knows which SSRC to expect and fires
    // OnTrack when the first RTP packet arrives.
    //
    // Using addTransceiver({ direction: 'sendonly' }) here is wrong: Chrome will not
    // match sendonly local transceivers to recvonly offer m-sections and instead
    // creates separate, empty transceivers — senders have no track, no SSRC,
    // no RTP, OnTrack never fires. addTrack (sendrecv) avoids this.
    // Log codec capabilities before adding tracks so we can compare what macOS/Android
    // browsers offer vs Linux. Critical for diagnosing Opus parameter mismatches.
    const audioCaps = RTCRtpSender.getCapabilities('audio');
    gcLog(this.currentUserId, 'RTP capabilities', {
      audioCodecs: audioCaps?.codecs.map((c) => `${c.mimeType} ${c.sdpFmtpLine ?? ''}`.trimEnd()),
    });

    // Slot order is a hard contract with the SFU, which pre-creates exactly four
    // recvonly transceivers in this order (see NewParticipantSession):
    //   [0] audio — microphone
    //   [1] video — camera
    //   [2] video — screen share
    //   [3] audio — screen share
    // Chrome answers positionally, m-line by m-line, so every branch below MUST
    // create exactly these four transceivers in exactly this order. A mismatch
    // is silent: e.g. a missing mic slot makes the server bind our screen-share
    // audio to its mic slot (RoleCameraOrMic), which broadcasts it to everyone
    // regardless of who is watching the share.
    const addedTracks: Array<Record<string, unknown>> = [];
    const logAddedTrack = (track: MediaStreamTrack) => {
      addedTracks.push({
        kind: track.kind,
        id: track.id.slice(0, 8),
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState,
        label: track.label,
      });
    };

    if (this.localStream) {
      // Audio and video are added separately (rather than iterating getTracks())
      // so slot order never depends on the stream's internal track ordering.
      const localAudioTracks = this.localStream.getAudioTracks();
      const localVideoTracks = this.localStream.getVideoTracks();

      // [0] mic-audio. Pass the stream so Chrome writes a=msid:<streamId> <trackId>
      // in the answer SDP. Without the stream argument the SDP contains
      // "a=msid:- <trackId>": some pion versions see the dash as an empty
      // streamID and may not fire OnTrack reliably.
      if (localAudioTracks.length > 0) {
        for (const track of localAudioTracks) {
          pc.addTrack(track, this.localStream);
          logAddedTrack(track);
        }
      } else {
        // Mic denied/unavailable while a camera exists (acquireMedia's
        // video-only fallback). The slot must still be reserved, otherwise the
        // only audio transceiver on this PC would be the screen-audio one and
        // the server would bind it to its mic slot. A silent track (not a
        // trackless transceiver) keeps the slot non-empty so the screen-audio
        // addTrack below creates its own transceiver instead of reusing this one.
        pc.addTrack(this.createMicDummyAudioTrack(), new MediaStream([this.dummyMicAudioTrack!]));
      }

      // [1] camera-video. If there is no camera, a dummy track (not a trackless
      // transceiver) is required so the answer SDP carries a video a=ssrc line —
      // see createDummyVideoTrack for why.
      if (localVideoTracks.length > 0) {
        for (const track of localVideoTracks) {
          pc.addTrack(track, this.localStream);
          logAddedTrack(track);
        }
      } else {
        this.dummyVideoTrack = this.createDummyVideoTrack();
        pc.addTrack(this.dummyVideoTrack, this.localStream);
      }
    } else {
      // No local media at all. Audio gets a silent dummy track (non-empty, so the
      // screen-audio addTrack below can't reuse it); video still needs a dummy
      // track for screen sharing.
      pc.addTrack(this.createMicDummyAudioTrack(), new MediaStream([this.dummyMicAudioTrack!])); // [0]
      this.dummyVideoTrack = this.createDummyVideoTrack();
      pc.addTrack(this.dummyVideoTrack, new MediaStream([this.dummyVideoTrack])); // [1]
    }

    // [2] screen-video, [3] screen-audio — dedicated slots, added on EVERY join.
    // Placeholder (dummy) tracks establish the SSRC now so starting/stopping a
    // share later is a plain replaceTrack with no renegotiation — same reasoning
    // as the camera dummy track above.
    //
    // Use addTrack (NOT addTransceiver-with-sendrecv): client measurements show
    // addTransceiver(track, {direction:'sendrecv'}) leaves the sender ORPHANED
    // (mid=null, currentDirection=null) against the server's recvonly offer
    // m-line, so the screen slot never transmits. addTrack binds to its m-line
    // exactly like the mic/camera senders. Reuse is avoided because every
    // preceding sender of the same kind already carries a track (mic/camera are
    // non-empty here), so addTrack creates a genuinely new transceiver instead of
    // cannibalising an earlier slot.
    this.dummyScreenVideoTrack = this.createDummyVideoTrack();
    const screenVideoStream = new MediaStream([this.dummyScreenVideoTrack]);
    this.screenVideoSender = pc.addTrack(this.dummyScreenVideoTrack, screenVideoStream);

    const dummyScreenAudioTrack = this.createDummyAudioTrack();
    const screenAudioStream = new MediaStream([dummyScreenAudioTrack]);
    this.screenAudioSender = pc.addTrack(dummyScreenAudioTrack, screenAudioStream);

    gcLog(this.currentUserId, 'PC created', {
      localTracksAdded: addedTracks,
      transceivers: pc.getTransceivers().map((t) => ({
        mid: t.mid,
        direction: t.direction,
        senderTrackKind: t.sender.track?.kind ?? null,
        senderTrackEnabled: t.sender.track?.enabled ?? null,
        senderTrackMuted: t.sender.track?.muted ?? null,
        senderTrackReadyState: t.sender.track?.readyState ?? null,
      })),
    });

    const remoteTrackMonitors = new Map<string, ReturnType<typeof setInterval>>();

    pc.ontrack = (event) => {
      const ontrackAt = Date.now();
      const streamId = event.streams[0]?.id ?? event.track.id;
      gcLog(this.currentUserId, 'ontrack', {
        trackKind: event.track.kind,
        trackId: event.track.id.slice(0, 8),
        trackReadyState: event.track.readyState,
        trackEnabled: event.track.enabled,
        streamId: streamId.slice(0, 8),
        streamsCount: event.streams.length,
        stream0id: event.streams[0]?.id?.slice(0, 8) ?? null,
        echoGuardWouldFire: streamId === this.currentUserId,
        currentUserId: this.currentUserId.slice(0, 8),
        elapsedFromJoinMs: this.joinedAt ? ontrackAt - this.joinedAt : -1,
        elapsedFromConnectedMs: this.pcConnectedAt ? ontrackAt - this.pcConnectedAt : -1,
      });

      const screenSuffix = ':screen';
      const isScreenTrack = streamId.endsWith(screenSuffix);
      const ownerUserId = isScreenTrack ? streamId.slice(0, -screenSuffix.length) : streamId;

      if (ownerUserId === this.currentUserId) {
        gcLog(this.currentUserId, 'ontrack BLOCKED by echo guard', { streamId: streamId.slice(0, 8) });
        return;
      }

      // Per-track inbound stats monitor. Uses receiver.getStats() instead of pc.getStats()
      // so we get the inbound-rtp report directly without filtering by trackId — the
      // trackId field is deprecated and absent on some mobile browsers (Android WebView,
      // older Safari). Detects first non-zero packetsReceived and emits a [METRIC] log
      // with elapsed times for diagnosing mobile audio delays.
      if (event.track.kind === 'audio') {
        const receiver = event.receiver;
        const trackIdShort = event.track.id.slice(0, 8);
        let firstFrameSeen = false;

        // VYC-76 diagnostics: previous sample, so every counter below can be
        // reported as a per-tick DELTA. Cumulative totals are useless here —
        // the bug is a transient burst, and a burst is only visible as a spike
        // in a rate.
        let prevAt = 0;
        let prevPacketsReceived = 0;
        let prevAccelSamples = 0;
        let prevDecelSamples = 0;
        let prevConcealed = 0;
        let prevJbDelay = 0;
        let prevJbEmitted = 0;

        const monitorId = setInterval(async () => {
          if (!this.pc || this.pc.connectionState !== 'connected') {
            clearInterval(monitorId);
            remoteTrackMonitors.delete(event.track.id);
            return;
          }
          try {
            const stats = await receiver.getStats();
            let packetsReceived = 0;
            let packetsLost = 0;
            let bytesReceived = 0;
            let jitter = 0;
            let audioLevel: number | undefined;
            let totalAudioEnergy: number | undefined;
            // VYC-76: NetEq counters. removedSamplesForAcceleration is literally
            // "how many samples NetEq deleted by time-compressing playout" — i.e.
            // the "he suddenly talked fast" symptom, measured directly.
            let accelSamples = 0;
            let decelSamples = 0;
            let concealed = 0;
            let jbDelay = 0;
            let jbEmitted = 0;
            stats.forEach((r) => {
              if (r.type === 'inbound-rtp') {
                packetsReceived = (r.packetsReceived as number) ?? 0;
                packetsLost = (r.packetsLost as number) ?? 0;
                bytesReceived = (r.bytesReceived as number) ?? 0;
                jitter = (r.jitter as number) ?? 0;
                audioLevel = (r as any).audioLevel;
                totalAudioEnergy = (r as any).totalAudioEnergy;
                accelSamples = ((r as any).removedSamplesForAcceleration as number) ?? 0;
                decelSamples = ((r as any).insertedSamplesForDeceleration as number) ?? 0;
                concealed = ((r as any).concealedSamples as number) ?? 0;
                jbDelay = ((r as any).jitterBufferDelay as number) ?? 0;
                jbEmitted = ((r as any).jitterBufferEmittedCount as number) ?? 0;
              }
            });

            // ── VYC-76 burst/acceleration detector ───────────────────────────
            const nowMs = Date.now();
            if (prevAt > 0) {
              const dSec = (nowMs - prevAt) / 1000;
              const dPackets = packetsReceived - prevPacketsReceived;
              const dAccel = accelSamples - prevAccelSamples;
              const dDecel = decelSamples - prevDecelSamples;
              const dConcealed = concealed - prevConcealed;
              const dJbDelay = jbDelay - prevJbDelay;
              const dJbEmitted = jbEmitted - prevJbEmitted;
              // Packets/sec. Opus at 20ms ptime is 50 pps in steady state; a
              // burst released after an upstream stall shows up as a large
              // overshoot, a stall as a large undershoot.
              const pps = dSec > 0 ? dPackets / dSec : 0;
              // Current jitter-buffer depth in ms, averaged over this tick only.
              const jbMs = dJbEmitted > 0 ? (dJbDelay / dJbEmitted) * 1000 : -1;
              // Playout speed-up over this tick: samples NetEq deleted, as a
              // fraction of what it should have emitted. 0.05 = played 5% fast.
              const accelRatio = dJbEmitted > 0 ? dAccel / dJbEmitted : 0;
              const fields = {
                streamId: streamId.slice(0, 8),
                trackId: trackIdShort,
                pps: pps.toFixed(1),
                jitterBufferMs: jbMs >= 0 ? jbMs.toFixed(0) : 'N/A',
                accelSamplesDelta: dAccel,
                accelPct: (accelRatio * 100).toFixed(2),
                decelSamplesDelta: dDecel,
                concealedDelta: dConcealed,
                jitterMs: (jitter * 1000).toFixed(1),
                elapsedFromJoinMs: this.joinedAt ? nowMs - this.joinedAt : -1,
              };
              // 1% time-compression over a whole tick is well past "inaudible
              // NetEq housekeeping" and into the reported symptom.
              // Two thresholds, deliberately far apart.
              //
              // NetEq time-compresses a little all the time; at 1% over a tick
              // that is housekeeping, not the bug. The console line is free and
              // rides along in breadcrumbs, so it stays sensitive at 1% and
              // gives the full run-up to any event we do send.
              //
              // The GlitchTip report must be much stricter: reports are capped
              // at 10 per call, so anything that fires on background behaviour
              // burns the whole budget in the first half-minute and the real
              // burst never leaves the machine. The reported symptom — a full
              // second of speech compressed away — is ~50% over a 2s tick, so
              // 5% is still an order of magnitude below it while sitting well
              // clear of the noise floor.
              if (accelRatio > 0.01) {
                gcLog(this.currentUserId, '[VYC-76] PLAYOUT ACCELERATED (NetEq time-compression)', fields);
              } else {
                gcLog(this.currentUserId, '[VYC-76] inbound pacing', fields);
              }
              if (accelRatio > 0.05) {
                // peerUserId is the PUBLISHER whose voice sped up — the join key
                // against that publisher's own uplink-pacing report.
                this.reportVyc76('inbound-accel', 'VYC-76 playout accelerated (NetEq time-compression)', {
                  ...fields,
                  peerUserId: ownerUserId.slice(0, 8),
                  accelPctNum: accelRatio * 100,
                  ppsNum: Number(pps.toFixed(1)),
                  jitterBufferMsNum: jbMs,
                  packetsLost,
                  tickSec: dSec,
                });
              }
            }
            prevAt = nowMs;
            prevPacketsReceived = packetsReceived;
            prevAccelSamples = accelSamples;
            prevDecelSamples = decelSamples;
            prevConcealed = concealed;
            prevJbDelay = jbDelay;
            prevJbEmitted = jbEmitted;

            if (!firstFrameSeen && packetsReceived > 0) {
              firstFrameSeen = true;
              const now = Date.now();
              this.firstAudioFrameAt.set(streamId, now);
              gcLog(this.currentUserId, '[METRIC] first-audio-frame', {
                streamId: streamId.slice(0, 8),
                packetsReceived,
                elapsedFromJoinMs: this.joinedAt ? now - this.joinedAt : -1,
                elapsedFromOntrackMs: now - ontrackAt,
                elapsedFromConnectedMs: this.pcConnectedAt ? now - this.pcConnectedAt : -1,
              });
            }

            const silentStream = firstFrameSeen && packetsReceived > 50 && (audioLevel == null || audioLevel < 0.001);
            if (silentStream) {
              gcLog(this.currentUserId, 'WARNING: silent inbound stream (packets flowing but audioLevel≈0)', {
                streamId: streamId.slice(0, 8),
                packetsReceived,
                audioLevel: audioLevel ?? 'N/A',
                totalAudioEnergy: totalAudioEnergy ?? 'N/A',
                elapsedFromJoinMs: this.joinedAt ? Date.now() - this.joinedAt : -1,
              });
            }
            gcLog(this.currentUserId, 'inbound remote audio', {
              streamId: streamId.slice(0, 8),
              trackId: trackIdShort,
              packetsReceived,
              packetsLost,
              bytesReceived,
              jitter: jitter.toFixed(4),
              audioLevel: audioLevel != null ? audioLevel.toFixed(4) : 'N/A',
              totalAudioEnergy: totalAudioEnergy != null ? totalAudioEnergy.toFixed(4) : 'N/A',
              firstFrameSeen,
              elapsedFromJoinMs: this.joinedAt ? Date.now() - this.joinedAt : -1,
            });
          } catch (_) {}
        }, 2000);
        remoteTrackMonitors.set(event.track.id, monitorId);
      }

      const targetMap = isScreenTrack ? this.remoteScreenStreams : this.remoteStreams;
      let stream = targetMap.get(ownerUserId);
      if (!stream) {
        stream = event.streams[0] ?? new MediaStream();
        targetMap.set(ownerUserId, stream);
        gcLog(this.currentUserId, 'ontrack new remote stream', { streamId: streamId.slice(0, 8), isScreenTrack });
      }
      if (!stream.getTrackById(event.track.id)) {
        stream.addTrack(event.track);
      }
      // Reference bus for our OWN outgoing screen-share AEC — only camera/mic
      // audio from other participants is a useful echo reference, never
      // someone else's screen-share audio.
      if (this._isScreenSharing && !isScreenTrack && event.track.kind === 'audio') {
        echoCancellationService.addReferenceTrack(ownerUserId, event.track);
      }

      if (isScreenTrack) {
        gcLog(this.currentUserId, 'ontrack → onRemoteScreenStream', {
          ownerUserId: ownerUserId.slice(0, 8),
          tracksInStream: stream.getTracks().map((t) => `${t.kind}:${t.id.slice(0, 8)}`),
        });
        this.callbacks?.onRemoteScreenStream(ownerUserId, stream);
      } else {
        gcLog(this.currentUserId, 'ontrack → onRemoteStream', {
          streamId: streamId.slice(0, 8),
          tracksInStream: stream.getTracks().map((t) => `${t.kind}:${t.id.slice(0, 8)}`),
        });
        this.callbacks?.onRemoteStream(ownerUserId, stream);
      }
    };

    // Monitor local audio track + all senders every 3s for 60s.
    // Runs past the initial ICE connection so we also capture the state after
    // renegotiation that adds forwarded remote tracks (which doesn't change PC state).
    const monitorStart = Date.now();
    const audioMonitorId = setInterval(async () => {
      if (!this.localStream || !this.pc) {
        clearInterval(audioMonitorId);
        return;
      }
      if (Date.now() - monitorStart > 60_000) {
        clearInterval(audioMonitorId);
        return;
      }
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (!audioTrack) {
        clearInterval(audioMonitorId);
        return;
      }
      const senders = this.pc.getSenders();
      const audioSender = senders.find((s) => s.track?.kind === 'audio');

      // Check local audio level from outbound stats
      let audioLevel = -1;
      try {
        const stats = await this.pc.getStats();
        stats.forEach((r) => {
          if (r.type === 'media-source' && (r as any).kind === 'audio' && (r as any).trackIdentifier === audioTrack.id) {
            audioLevel = (r as any).audioLevel ?? -1;
          }
          if (r.type === 'outbound-rtp' && r.kind === 'audio') {
            // also log audioLevel from encoder if available
            audioLevel = Math.max(audioLevel, (r as any).audioLevel ?? (r as any).qualityLimitationReason ?? -1);
          }
        });
      } catch (_) {}

      gcLog(this.currentUserId, 'audio track monitor', {
        trackEnabled: audioTrack.enabled,
        trackMuted: audioTrack.muted,
        trackReadyState: audioTrack.readyState,
        localAudioLevel: audioLevel > 0 ? audioLevel.toFixed(4) : 'N/A',
        pcConnectionState: this.pc.connectionState,
        pcSignalingState: this.pc.signalingState,
        senderFound: audioSender != null,
        senderHasTrack: audioSender?.track != null,
        senderTrackMuted: audioSender?.track?.muted ?? null,
        senderTrackReadyState: audioSender?.track?.readyState ?? null,
        senderCount: senders.length,
        transceiverCount: this.pc.getTransceivers().length,
      });
    }, 3000);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        gcLog(this.currentUserId, 'ICE candidate (local)', {
          type: event.candidate.type,
          protocol: event.candidate.protocol,
        });
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'ice_candidate',
            payload: event.candidate.toJSON(),
          }));
        }
      } else {
        gcLog(this.currentUserId, 'ICE gathering complete');
      }
    };

    pc.onconnectionstatechange = () => {
      gcLog(this.currentUserId, 'PC connectionState', { state: pc.connectionState });
      if (pc.connectionState === 'failed') {
        // ICE has given up entirely — there is no path left to restart onto.
        this.recovery?.cancel();
        void this.reconnect('pc_failed');
      }
      if (pc.connectionState === 'disconnected') {
        this.recovery?.onDisconnected();
      }
      if (pc.connectionState === 'connected') {
        this.recovery?.onConnected();
        this.pcConnectedAt = Date.now();
        gcLog(this.currentUserId, '[METRIC] pc-connected', {
          elapsedFromJoinMs: this.joinedAt ? this.pcConnectedAt - this.joinedAt : -1,
          elapsedFromPcCreateMs: this.pcConnectedAt - this.pcCreatedAt,
        });
        // Start RTCStats polling to confirm RTP is actually flowing end-to-end.
        // outbound-rtp: confirms A is sending audio to SFU.
        // inbound-rtp: confirms SFU is forwarding audio to this client (B).
        // Polls for 90s then stops to avoid long-term overhead.
        let statsPollCount = 0;
        const statsIntervalId = setInterval(async () => {
          if (!this.pc || this.pc.connectionState !== 'connected') {
            clearInterval(statsIntervalId);
            return;
          }
          if (statsPollCount >= 30) { // 30 × 3s = 90s
            clearInterval(statsIntervalId);
            return;
          }
          statsPollCount++;
          try {
            const stats = await this.pc.getStats();
            const outbound: Record<string, unknown>[] = [];
            const inbound: Record<string, unknown>[] = [];
            const candidatePair: Record<string, unknown>[] = [];
            stats.forEach((report) => {
              if (report.type === 'outbound-rtp') {
                outbound.push({
                  kind: report.kind,
                  ssrc: report.ssrc,
                  packetsSent: report.packetsSent,
                  bytesSent: report.bytesSent,
                  retransmittedPacketsSent: report.retransmittedPacketsSent ?? 0,
                });
              } else if (report.type === 'inbound-rtp') {
                inbound.push({
                  kind: report.kind,
                  ssrc: report.ssrc,
                  packetsReceived: report.packetsReceived,
                  bytesReceived: report.bytesReceived,
                  packetsLost: report.packetsLost,
                  jitter: (report.jitter as number | undefined)?.toFixed(4) ?? null,
                });
              } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                candidatePair.push({
                  state: report.state,
                  bytesSent: report.bytesSent,
                  bytesReceived: report.bytesReceived,
                  currentRoundTripTime: report.currentRoundTripTime,
                });
              }
            });
            gcLog(this.currentUserId, `RTC stats #${statsPollCount}`, {
              outbound,
              inbound,
              activeCandidatePairs: candidatePair,
            });

            // After 12 seconds (4 polls × 3s) with no outbound audio, emit a
            // prominent warning so we can see in logs whether the track itself is
            // silent or whether the problem is upstream (ICE, DTLS, SFU routing).
            if (statsPollCount === 4) {
              const audioOut = outbound.find((o) => o.kind === 'audio');
              const videoOut = outbound.find((o) => o.kind === 'video');
              if (!audioOut || (audioOut.packetsSent as number) === 0) {
                gcLog(this.currentUserId, 'WARNING: 0 audio packets sent after 12s', {
                  audioOutbound: audioOut ?? null,
                  videoOutbound: videoOut ?? null,
                  localAudioTrack: this.localStream?.getAudioTracks().map((t) => ({
                    enabled: t.enabled, muted: t.muted, readyState: t.readyState,
                    settings: t.getSettings(),
                  })),
                  audioCtxState: this.localStream
                    ? noiseCancellationService.getChainContextState(this.localStream.id)
                    : 'no-ctx',
                  pcSignalingState: this.pc?.signalingState ?? null,
                  transceivers: this.pc?.getTransceivers().map((t) => ({
                    mid: t.mid,
                    direction: t.direction,
                    currentDirection: t.currentDirection,
                    senderTrackKind: t.sender.track?.kind ?? null,
                    senderTrackMuted: t.sender.track?.muted ?? null,
                  })),
                });
              }
            }
          } catch (err) {
            gcLog(this.currentUserId, 'getStats ERROR', { error: String(err) });
          }
        }, 3000);

        this.startQualitySampler();
      }
    };

    pc.onsignalingstatechange = () => {
      gcLog(this.currentUserId, 'PC signalingState', { state: pc.signalingState });
    };

    pc.onicegatheringstatechange = () => {
      gcLog(this.currentUserId, 'ICE gatheringState', {
        state: pc.iceGatheringState,
        elapsedFromPcCreateMs: Date.now() - this.pcCreatedAt,
      });
    };

    pc.oniceconnectionstatechange = () => {
      gcLog(this.currentUserId, 'ICE connectionState', { state: pc.iceConnectionState });
    };

    return pc;
  }

  // ── Private: signaling message routing ────────────────────────────────────

  private async handleMessage(msg: SignalingMessage): Promise<void> {
    switch (msg.type) {
      case 'offer':
        await this.handleOffer(msg.payload as OfferPayload);
        break;

      case 'ice_candidate':
        await this.handleIceCandidate(msg.payload as IceCandidatePayload);
        break;

      case 'participant_joined':
        this.callbacks?.onPeerJoined((msg.payload as ParticipantEventPayload).user_id, 'live');
        break;

      case 'participant_left': {
        const { user_id } = msg.payload as ParticipantEventPayload;
        // Evicting our own stale session broadcasts participant_left with OUR user_id
        // to the freshly registered session (RoomSession.Join registers the new session
        // before finishLeave(stale), and broadcastEvent excludes by participantID) — and
        // it arrives before 'joined'. That is not a departure: without this guard the UI
        // chimes "someone left" on every reconnect inside disconnectedTimeout and on a
        // second-device login.
        if (user_id === this.currentUserId) break;
        this.remoteStreams.delete(user_id);
        this.remoteScreenStreams.delete(user_id);
        if (this._isScreenSharing) echoCancellationService.removeReferenceTrack(user_id);
        this.callbacks?.onPeerLeft(user_id);
        break;
      }

      case 'session_replaced':
        // The server evicted this session because the same user joined from
        // another device/tab. Auto-rejoining here would evict THAT session and
        // start an endless mutual-eviction ping-pong — treat it as an
        // intentional leave instead and let the close event end the call.
        gcLog(this.currentUserId, 'session replaced by another connection — suppressing auto-rejoin');
        this.intentionalLeave = true;
        if (this.reconnecting) {
          // The reconnect loop exits silently on intentionalLeave, so reset
          // the UI ourselves.
          this.callbacks?.onCallEnded();
          this.teardown();
        }
        break;

      case 'error':
        if (!this.reconnecting) {
          this.callbacks?.onError((msg.payload as ErrorPayload).message);
        }
        break;

      default:
        break;
    }
  }

  // ── Private: offer/answer ─────────────────────────────────────────────────

  private async handleOffer(payload: OfferPayload): Promise<void> {
    const isFirst = !this.pc;
    gcLog(this.currentUserId, 'offer received', {
      isFirstOffer: isFirst,
      signalingState: this.pc?.signalingState ?? 'no-pc',
      pendingCandidates: this.pendingCandidates.length,
    });

    // Server-initiated offer: create PC on first offer, reuse on renegotiation.
    if (!this.pc) {
      this.pc = this.createPeerConnection();
    }

    try {
      await this.pc.setRemoteDescription({ type: payload.type, sdp: payload.sdp });
    } catch (err) {
      gcLog(this.currentUserId, 'setRemoteDescription ERROR', { error: String(err) });
      logger.error('[GroupCall] setRemoteDescription failed:', err, { module: 'groupCall' });
      // PC stays in stable — server will timeout and rollback on its side.
      return;
    }

    // Log transceivers after setRemoteDescription to see all m-lines including forwarded tracks.
    gcLog(this.currentUserId, 'transceivers after setRemoteDesc', {
      transceivers: this.pc.getTransceivers().map((t, i) => ({
        index: i,
        mid: t.mid,
        direction: t.direction,
        currentDirection: t.currentDirection,
        senderTrackKind: t.sender.track?.kind ?? null,
        senderTrackId: t.sender.track?.id?.slice(0, 8) ?? null,
        receiverTrackKind: t.receiver.track.kind,
        receiverTrackId: t.receiver.track.id.slice(0, 8),
        receiverTrackReadyState: t.receiver.track.readyState,
      })),
    });

    // Flush any ICE candidates that arrived before remote description.
    if (this.pendingCandidates.length > 0) {
      gcLog(this.currentUserId, 'flushing pending ICE', { count: this.pendingCandidates.length });
    }
    for (const c of this.pendingCandidates) {
      await this.pc.addIceCandidate(c).catch(() => { /* stale candidate */ });
    }
    this.pendingCandidates = [];

    // Constrain audio codec to Opus-only BEFORE createAnswer.
    // macOS Chrome adds stereo fmtp params (stereo=1;sprop-stereo=1) to Opus by default.
    // These parameters tell the remote decoder to expect stereo frames, but our pion SFU
    // is configured for mono Opus.  When the fmtp lines don't match, pion may reject the
    // codec negotiation silently — no OnTrack, no audio.  Restricting codecs to plain Opus
    // entries (without stereo variants) eliminates the mismatch on all platforms.
    const opusCaps = RTCRtpSender.getCapabilities('audio');
    for (const t of this.pc!.getTransceivers()) {
      if (t.receiver.track.kind !== 'audio') continue;
      if (!opusCaps) continue;
      // Keep only Opus entries; drop RED, CN, telephone-event, etc.
      // Using toLowerCase() because Chrome reports "audio/opus" and Safari "audio/OPUS".
      const opusOnly = opusCaps.codecs.filter((c) => c.mimeType.toLowerCase() === 'audio/opus');
      if (opusOnly.length === 0) continue;
      try {
        t.setCodecPreferences(opusOnly);
        gcLog(this.currentUserId, 'setCodecPreferences Opus', { mid: t.mid, variants: opusOnly.length });
      } catch (e) {
        gcLog(this.currentUserId, 'setCodecPreferences ERROR', { mid: t.mid, error: String(e) });
      }
    }

    let answer: RTCSessionDescriptionInit;
    try {
      answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
    } catch (err) {
      gcLog(this.currentUserId, 'createAnswer ERROR', { error: String(err) });
      logger.error('[GroupCall] createAnswer/setLocalDescription failed:', err, { module: 'groupCall' });
      // PC is in have-remote-offer — rollback so future offers can be processed.
      await this.pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
      return;
    }

    // Log SDP answer sections — critical for diagnosing why audio is not sent.
    // direction=sendonly/sendrecv → Chrome sends; recvonly/inactive → Chrome won't send.
    // ssrcs=[] → Chrome has no sender track (audio won't be transmitted).
    gcLog(this.currentUserId, 'answer SDP sections', {
      sections: parseSdpSections(answer.sdp ?? '').map((s) => ({
        mLine: (s.mLine as string).slice(0, 40),
        mid: s.mid,
        direction: s.direction,
        ssrcCount: (s.ssrcs as string[]).length,
        firstSsrc: (s.ssrcs as string[])[0] ?? null,
        msids: s.msids,
      })),
    });

    // Also log transceiver state AFTER setLocalDescription (currentDirection is set here).
    gcLog(this.currentUserId, 'transceivers after setLocalDesc', {
      transceivers: this.pc!.getTransceivers().map((t) => ({
        mid: t.mid,
        direction: t.direction,
        currentDirection: t.currentDirection,
        senderTrackKind: t.sender.track?.kind ?? null,
        senderTrackMuted: t.sender.track?.muted ?? null,
        senderTrackReadyState: t.sender.track?.readyState ?? null,
      })),
    });

    gcLog(this.currentUserId, 'answer sent');

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'answer',
        payload: { type: answer.type, sdp: answer.sdp },
      }));
    }

    this.applyScreenRestore();
  }

  private async handleIceCandidate(payload: IceCandidatePayload): Promise<void> {
    const init: RTCIceCandidateInit = {
      candidate: payload.candidate,
      sdpMid: payload.sdpMid,
      sdpMLineIndex: payload.sdpMLineIndex,
      usernameFragment: payload.usernameFragment ?? undefined,
    };

    if (!this.pc?.remoteDescription) {
      gcLog(this.currentUserId, 'ICE candidate buffered (no remoteDesc)', {
        total: this.pendingCandidates.length + 1,
      });
      this.pendingCandidates.push(init);
      return;
    }

    await this.pc.addIceCandidate(init).catch((err) => {
      gcLog(this.currentUserId, 'addIceCandidate ERROR', { error: String(err) });
    });
  }

  // ── Private: cleanup ──────────────────────────────────────────────────────

  private teardown(): void {
    gcLog(this.currentUserId, '[METRIC] call-summary', {
      callDurationMs: this.joinedAt ? Date.now() - this.joinedAt : -1,
      firstAudioFrames: Object.fromEntries(
        [...this.firstAudioFrameAt.entries()].map(([sid, ts]) => [
          sid.slice(0, 8),
          { elapsedFromJoinMs: this.joinedAt ? ts - this.joinedAt : -1 },
        ])
      ),
    });
    gcLog(this.currentUserId, 'teardown', {
      remoteStreams: this.remoteStreams.size,
      pcState: this.pc?.connectionState ?? 'null',
    });
    this.stopQualitySampler();
    this.pc?.close();
    this.pc = null;
    this.resumeToken = null;

    this.screenAecDetach?.();
    this.screenAecDetach = null;
    echoCancellationService.teardownReferenceBus();

    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.screenVideoSender = null;
    this.screenAudioSender = null;
    this._isScreenSharing = false;

    this.dummyScreenVideoTrack?.stop();
    this.dummyScreenVideoTrack = null;
    this.releaseDummyScreenAudio();
    this.releaseMicDummyAudio();

    if (this.localStream) {
      // Демонтаж NC-цепочки: стопает raw-треки микрофона, закрывает AudioContext
      // и снимает keepAlive-поллинг (всё это теперь живёт внутри сервиса).
      noiseCancellationService.releaseChain(this.localStream.id);
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    this.dummyVideoTrack?.stop();
    this.dummyVideoTrack = null;

    this.remoteStreams.clear();
    this.remoteScreenStreams.clear();
    this.pendingCandidates = [];
    this.inCall = false;
    // Cleared only on full teardown (not partialTeardown, which the reconnect
    // loop relies on reading this.currentRoomId from to rejoin the SAME room —
    // see reconnect()). Stale currentRoomId after a real leave would make a
    // same-room rejoin's "already in this room" check misfire and suppress
    // the voice_joined WS send.
    this.currentRoomId = '';
    this._microphoneAvailable = false;
    this.micMuted = false;
    this.stopMicWatch();
    this.micRebuildCount = 0;
    this.micRebuildFailures = 0;
    this.micRebuildBlockedUntil = 0;
    // A never-settling rebuild must not wedge the watch off for later calls.
    this.micRebuildInFlight = false;
    this.joinedAt = 0;
    this.pcCreatedAt = 0;
    this.pcConnectedAt = 0;
    this.firstAudioFrameAt.clear();
    this.recovery?.cancel();
    this.recovery = null;
    this.pendingScreenRestore = null;
    // Detach handlers before dropping the reference: a late onclose from the
    // last retry attempt's socket must not re-fire onCallEnded/teardown.
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
    }
    this.ws = null;
  }
}

export const groupCallService = new GroupCallService();
