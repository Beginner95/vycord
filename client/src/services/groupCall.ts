import { noiseCancellationService } from './noiseCancellation';
import { getIceServers, STUN_SERVERS } from './iceConfig';

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
  onPeerJoined: (userId: string) => void;
  onPeerLeft: (userId: string) => void;
  onCallEnded: () => void;
  onError: (error: string) => void;
  // Called when the OS screen-capture source is closed by the user (e.g. stop button in Chrome bar).
  onScreenShareEnded?: () => void;
  // Fired when the call dropped due to a network change and auto-reconnect started.
  onReconnecting?: () => void;
  // Fired when auto-reconnect restored the call.
  onReconnected?: () => void;
}

// ─── Internal state ──────────────────────────────────────────────────────────

// Maps stream ID (= remote user ID) to the MediaStream accumulating their tracks.
type RemoteStreams = Map<string, MediaStream>;

class GroupCallService {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  // Refreshed on every joinGroupCall; TURN entries carry ephemeral credentials.
  private iceServers: RTCIceServer[] = STUN_SERVERS;
  private localStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private audioCtxKeepAlive: ReturnType<typeof setInterval> | null = null;

  private screenStream: MediaStream | null = null;
  private screenSender: RTCRtpSender | null = null;
  // Placeholder video track sent when no camera is available — see createDummyVideoTrack.
  private dummyVideoTrack: MediaStreamTrack | null = null;
  private _isScreenSharing = false;
  private _microphoneAvailable = false;

  // Keyed by the remote user's ID (= pion stream ID on track events).
  private remoteStreams: RemoteStreams = new Map();

  // ICE candidates buffered before setRemoteDescription has been called.
  private pendingCandidates: RTCIceCandidateInit[] = [];

  private callbacks: GroupCallCallbacks | null = null;
  private currentUserId = '';
  private currentRoomId = '';
  private inCall = false;

  // True once the user asked to leave — suppresses auto-reconnect (Task 3).
  private intentionalLeave = false;
  // True while the reconnect loop owns the WS/PC lifecycle — suppresses
  // onclose/onerror side effects from failed attempts.
  private reconnecting = false;
  // Started when the PC goes 'disconnected'; fires reconnect if it doesn't
  // recover — the browser can sit in 'disconnected' for tens of seconds
  // before 'failed' while the WS hangs half-open (VPN case).
  private disconnectedTimer: ReturnType<typeof setTimeout> | null = null;
  // Screen track waiting to be re-attached to the new PC after reconnect.
  private pendingScreenRestore: MediaStreamTrack | null = null;

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

    this.intentionalLeave = false;
    // A hung previous reconnect cycle (e.g. its attempt never settled) must not
    // silently disable auto-reconnect for this new call.
    this.reconnecting = false;
    this.currentUserId = userId;
    this.currentRoomId = roomId;

    try {
      const raw = await this.acquireMedia();
      if (raw !== null) {
        const hasAudio = raw.getAudioTracks().length > 0;
        this._microphoneAvailable = hasAudio;
        if (hasAudio) {
          // When NC is disabled, Chrome's push-model audio capture may fail silently
          // on certain hardware (track reports live/enabled but Opus gets zero frames).
          // Routing through Web Audio forces a pull-model render cycle that always
          // produces frames, ensuring RTP actually reaches the SFU.
          this.localStream = await noiseCancellationService.applyToStream(raw);
          if (!noiseCancellationService.getState().isEnabled) {
            this.localStream = await this.routeAudioThroughWebAudio(this.localStream);
          }
        } else {
          this.localStream = raw;
        }
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
    gcLog(this.currentUserId, 'reconnect: started', { trigger });
    this.callbacks?.onReconnecting?.();

    // A live local screen track survives a network change — remember it to
    // re-attach to the new PC. Mic/camera mute needs no snapshot: localStream
    // tracks are reused as-is, their .enabled flags persist.
    const screenTrack = this._isScreenSharing
      ? this.screenStream?.getVideoTracks()[0] ?? null
      : null;

    this.partialTeardown();

    // ~30s total.
    const delaysMs = [500, 1000, 2000, 4000, 8000, 8000, 8000];
    for (const [attempt, delay] of delaysMs.entries()) {
      await new Promise((r) => setTimeout(r, delay));
      if (this.intentionalLeave) {
        this.reconnecting = false;
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
    this.teardown();
    this.callbacks?.onCallEnded();
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
    if (this.disconnectedTimer !== null) {
      clearTimeout(this.disconnectedTimer);
      this.disconnectedTimer = null;
    }
    this.pc?.close();
    this.pc = null;
    // The new PC creates its own dummy track in createPeerConnection.
    this.dummyVideoTrack?.stop();
    this.dummyVideoTrack = null;
    this.screenSender = null; // belonged to the old PC
    this.remoteStreams.clear();
    this.pendingCandidates = [];
    this.inCall = false;
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

  // Re-attaches the pending screen track to the new PC's video sender. Also
  // called after each answer in handleOffer: if 'joined' resolved before the
  // first offer, the PC doesn't exist yet when restoreScreenShare runs.
  private applyScreenRestore(): void {
    const track = this.pendingScreenRestore;
    if (!track || !this.pc) return;
    const videoTransceiver = this.pc.getTransceivers().find(
      (t) => t.receiver.track.kind === 'video',
    );
    if (!videoTransceiver) return; // a later offer will bring the m-line
    this.pendingScreenRestore = null;
    if (videoTransceiver.direction === 'recvonly') {
      videoTransceiver.direction = 'sendrecv';
    }
    videoTransceiver.sender.replaceTrack(track).then(() => {
      this.screenSender = videoTransceiver.sender;
      // Same reasoning as startScreenShare: replaceTrack doesn't renegotiate,
      // the SFU needs an explicit keyframe push.
      this.requestKeyframeWithRetry();
      gcLog(this.currentUserId, 'reconnect: screen share restored');
    }).catch((err) => {
      gcLog(this.currentUserId, 'reconnect: screen restore failed', { error: String(err) });
    });
  }

  // ── Controls ───────────────────────────────────────────────────────────────

  toggleMuteAudio(): boolean {
    const t = this.localStream?.getAudioTracks()[0];
    if (!t) return false;
    t.enabled = !t.enabled;
    return !t.enabled; // true = muted
  }

  toggleMuteVideo(): boolean {
    const t = this.localStream?.getVideoTracks()[0];
    if (!t) return false;
    t.enabled = !t.enabled;
    return !t.enabled; // true = video off
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
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            maxWidth: preset.width,
            maxHeight: preset.height,
            maxFrameRate: preset.frameRate,
            minWidth: 640,
            minHeight: 360,
          },
        },
      } as unknown as MediaStreamConstraints);
    } else {
      // Browser fallback: native OS picker with ideal constraints.
      // ideal lets the browser pick the closest resolution; max prevents upscaling.
      stream = await (navigator.mediaDevices as MediaDevices & {
        getDisplayMedia(c: Record<string, unknown>): Promise<MediaStream>;
      }).getDisplayMedia({
        audio: false,
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

    // Find the video transceiver by receiver kind — works even if sender.track is null
    // (audio-only join where the client never added a local camera track).
    const videoTransceiver = this.pc.getTransceivers().find(
      (t) => t.receiver.track.kind === 'video',
    );
    if (!videoTransceiver) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('No video transceiver in peer connection');
    }

    // If the transceiver was recvonly (camera stream never started), switch to sendrecv
    // so the SFU knows to expect video from this participant.
    if (videoTransceiver.direction === 'recvonly') {
      videoTransceiver.direction = 'sendrecv';
    }

    // When the user stops sharing via the OS UI (e.g. Chrome's "Stop sharing" bar),
    // the browser fires 'ended' on the capture track. Mirror that into our state.
    screenTrack.onended = () => {
      gcLog(this.currentUserId, 'screen track ended by OS/user');
      void this.stopScreenShare();
      this.callbacks?.onScreenShareEnded?.();
    };

    await videoTransceiver.sender.replaceTrack(screenTrack);
    screenTrack.enabled = true;

    await this.applyScreenShareEncoding(videoTransceiver.sender, preset.maxBitrate);

    this.screenStream = stream;
    this.screenSender = videoTransceiver.sender;
    this._isScreenSharing = true;

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

    // Restore the camera track. If the camera was unavailable at join time,
    // cameraTrack will be null and the sender will stop sending video — correct.
    const cameraTrack = this.localStream?.getVideoTracks()[0] ?? null;
    if (this.screenSender) {
      await this.screenSender.replaceTrack(cameraTrack).catch((err) => {
        gcLog(this.currentUserId, 'stopScreenShare replaceTrack error', { error: String(err) });
      });
      // Lift the screen-share bitrate cap and degradation preference off the
      // sender — the camera (or dummy) track should run on browser defaults.
      await this.applyScreenShareEncoding(this.screenSender, null);
    }

    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.screenSender = null;

    // Same reasoning as in startScreenShare: switching back to the camera track
    // is another replaceTrack with no renegotiation, so push a keyframe explicitly.
    this.requestKeyframeWithRetry();

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

  private async routeAudioThroughWebAudio(stream: MediaStream): Promise<MediaStream> {
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) return stream;
    try {
      const ctx = new AudioContext({ sampleRate: 48000 });
      gcLog(this.currentUserId, 'WebAudio passthrough: AudioContext state', { state: ctx.state });
      if (ctx.state !== 'running') {
        await ctx.resume();
        gcLog(this.currentUserId, 'WebAudio passthrough: AudioContext resumed', { state: ctx.state });
      }
      const src = ctx.createMediaStreamSource(stream);
      const dst = ctx.createMediaStreamDestination();
      src.connect(dst);
      this.audioCtx = ctx;

      // macOS Chrome and Android Chrome both suspend AudioContext to save power when
      // there's no ongoing audio output — even with active getUserMedia capture.
      // A suspended context means dst.stream tracks produce silence: RTP packets are
      // sent but Opus frames are zeroed, so the receiver hears nothing.
      // Polling at 2s intervals and resuming keeps the context in 'running' state
      // without adding audio output (ctx.resume() alone is enough per the spec).
      this.audioCtxKeepAlive = setInterval(() => {
        if (ctx.state !== 'running') {
          gcLog(this.currentUserId, 'WebAudio: AudioContext not running — resuming', { state: ctx.state });
          ctx.resume().catch(() => {});
        }
      }, 2000);

      const out = new MediaStream([
        ...dst.stream.getAudioTracks(),
        ...stream.getVideoTracks(),
      ]);
      gcLog(this.currentUserId, 'WebAudio passthrough: stream created', {
        audioTracks: out.getAudioTracks().map((t) => ({ id: t.id.slice(0, 8), label: t.label })),
      });
      return out;
    } catch (err) {
      gcLog(this.currentUserId, 'WebAudio passthrough failed', { error: String(err) });
      return stream;
    }
  }

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
    this.dummyVideoTrack = track;
    return track;
  }

  private async acquireMedia(): Promise<MediaStream | null> {
    // Explicit constraints avoid macOS/Android-specific quirks:
    // - channelCount ideal:1 → Opus mono, prevents macOS from injecting stereo fmtp params
    //   that older pion versions may not accept (stereo=1;sprop-stereo=1 mismatch).
    // - sampleRate ideal:48000 → Opus native rate; avoids resampling artefacts on Android.
    // Using ideal: (not exact) so the browser still works on devices that can't hit 48kHz.
    const audioConstraints: MediaTrackConstraints = {
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 48000 },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
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

  private connectSignaling(roomId: string, userId: string): Promise<boolean> {
    // Read the token on every attempt, not once per call: a VYC-24 reconnect
    // may run after the user re-logged in, and a token frozen at join time
    // would be stale.
    const token = localStorage.getItem('vycord_token') ?? '';
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
        if (!this.reconnecting) this.callbacks?.onError('SFU connection timeout');
        settle(false);
      }, 10_000);

      this.ws!.onopen = () => {
        gcLog(userId, 'WS connected', { roomId });
        // The server creates the PC on its side upon WS upgrade — no explicit join message needed.
        // The server will immediately send us an "offer".
      };

      this.ws!.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as SignalingMessage;
        gcLog(userId, 'WS message', { type: msg.type });
        if (msg.type === 'joined') {
          this.inCall = true;
          this.joinedAt = Date.now();
          const joined = msg.payload as JoinedPayload;
          gcLog(userId, 'joined room', { existingPeers: joined.existing_peers ?? [] });
          // Notify the UI about participants who are already in the room.
          // Stale self entry may be present during reconnect: the server snapshots
          // existing peers before evicting our old session, so it can still include us —
          // rendering that would create a ghost self-tile.
          const peers = (joined.existing_peers ?? []).filter((uid) => uid !== userId);
          peers.forEach((uid) => this.callbacks?.onPeerJoined(uid));
          this.ws!.onmessage = (ev) => {
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

      this.ws!.onclose = (ev) => {
        gcLog(userId, 'WS closed', { code: ev.code, reason: ev.reason });
        settle(false);
        if (this.reconnecting) return; // reconnect loop owns the lifecycle
        if (this.inCall && !this.intentionalLeave) {
          void this.reconnect('ws_closed');
          return;
        }
        this.inCall = false;
        this.callbacks?.onCallEnded();
        this.teardown();
      };

      this.ws!.onerror = () => {
        gcLog(userId, 'WS ERROR');
        settle(false);
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

    const addedTracks: Array<Record<string, unknown>> = [];
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        // Pass the stream so Chrome writes a=msid:<streamId> <trackId> in the answer SDP.
        // Without the stream argument the SDP contains "a=msid:- <trackId>": some pion
        // versions see the dash as an empty streamID and may not fire OnTrack reliably.
        pc.addTrack(track, this.localStream);
        addedTracks.push({
          kind: track.kind,
          id: track.id.slice(0, 8),
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
          label: track.label,
        });
      }
      // If localStream has no video track (no camera), add a dummy video track so the
      // answer SDP carries a video a=ssrc line — see createDummyVideoTrack for why a
      // trackless addTransceiver does not achieve this.
      if (!this.localStream.getVideoTracks().length) {
        pc.addTrack(this.createDummyVideoTrack(), this.localStream);
      }
    } else {
      // No local media at all. Audio stays a trackless transceiver (nothing to send
      // without a mic), but video still needs a dummy track for screen sharing.
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      const dummy = this.createDummyVideoTrack();
      pc.addTrack(dummy, new MediaStream([dummy]));
    }
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

      if (streamId === this.currentUserId) {
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
            stats.forEach((r) => {
              if (r.type === 'inbound-rtp') {
                packetsReceived = (r.packetsReceived as number) ?? 0;
                packetsLost = (r.packetsLost as number) ?? 0;
                bytesReceived = (r.bytesReceived as number) ?? 0;
                jitter = (r.jitter as number) ?? 0;
                audioLevel = (r as any).audioLevel;
                totalAudioEnergy = (r as any).totalAudioEnergy;
              }
            });

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

      let stream = this.remoteStreams.get(streamId);
      if (!stream) {
        stream = event.streams[0] ?? new MediaStream();
        this.remoteStreams.set(streamId, stream);
        gcLog(this.currentUserId, 'ontrack new remote stream', { streamId: streamId.slice(0, 8) });
      }
      if (!stream.getTrackById(event.track.id)) {
        stream.addTrack(event.track);
      }
      gcLog(this.currentUserId, 'ontrack → onRemoteStream', {
        streamId: streamId.slice(0, 8),
        tracksInStream: stream.getTracks().map((t) => `${t.kind}:${t.id.slice(0, 8)}`),
      });
      this.callbacks?.onRemoteStream(streamId, stream);
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
        void this.reconnect('pc_failed');
      }
      if (pc.connectionState === 'disconnected' && this.disconnectedTimer === null) {
        this.disconnectedTimer = setTimeout(() => {
          this.disconnectedTimer = null;
          if (this.pc && this.pc.connectionState !== 'connected') {
            void this.reconnect('pc_disconnected_3s');
          }
        }, 3000);
      }
      if (pc.connectionState === 'connected') {
        if (this.disconnectedTimer !== null) {
          clearTimeout(this.disconnectedTimer);
          this.disconnectedTimer = null;
        }
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
                  audioCtxState: this.audioCtx?.state ?? 'no-ctx',
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
        this.callbacks?.onPeerJoined((msg.payload as ParticipantEventPayload).user_id);
        break;

      case 'participant_left': {
        const { user_id } = msg.payload as ParticipantEventPayload;
        this.remoteStreams.delete(user_id);
        this.callbacks?.onPeerLeft(user_id);
        break;
      }

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
      console.error('[GroupCall] setRemoteDescription failed:', err);
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
      console.error('[GroupCall] createAnswer/setLocalDescription failed:', err);
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
    this.pc?.close();
    this.pc = null;

    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.screenSender = null;
    this._isScreenSharing = false;

    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;

    this.dummyVideoTrack?.stop();
    this.dummyVideoTrack = null;

    if (this.audioCtxKeepAlive !== null) {
      clearInterval(this.audioCtxKeepAlive);
      this.audioCtxKeepAlive = null;
    }
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;

    this.remoteStreams.clear();
    this.pendingCandidates = [];
    this.inCall = false;
    this._microphoneAvailable = false;
    this.joinedAt = 0;
    this.pcCreatedAt = 0;
    this.pcConnectedAt = 0;
    this.firstAudioFrameAt.clear();
    if (this.disconnectedTimer !== null) {
      clearTimeout(this.disconnectedTimer);
      this.disconnectedTimer = null;
    }
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
