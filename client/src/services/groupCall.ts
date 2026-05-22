import { noiseCancellationService } from './noiseCancellation';

const SFU_URL = import.meta.env.VITE_SFU_URL || 'ws://localhost:8081';

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
}

// ─── Internal state ──────────────────────────────────────────────────────────

// Maps stream ID (= remote user ID) to the MediaStream accumulating their tracks.
type RemoteStreams = Map<string, MediaStream>;

class GroupCallService {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;

  // Keyed by the remote user's ID (= pion stream ID on track events).
  private remoteStreams: RemoteStreams = new Map();

  // ICE candidates buffered before setRemoteDescription has been called.
  private pendingCandidates: RTCIceCandidateInit[] = [];

  private callbacks: GroupCallCallbacks | null = null;
  private currentUserId = '';
  private currentRoomId = '';
  private inCall = false;

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

    this.currentUserId = userId;
    this.currentRoomId = roomId;

    try {
      const raw = await this.acquireMedia();
      this.localStream = await noiseCancellationService.applyToStream(raw);
      // Video starts disabled to avoid immediate bandwidth spike.
      this.localStream.getVideoTracks().forEach((t) => { t.enabled = false; });
      gcLog(userId, 'media acquired', {
        audioTracks: this.localStream.getAudioTracks().map((t) => ({
          id: t.id.slice(0, 8), label: t.label, enabled: t.enabled,
          readyState: t.readyState, muted: t.muted,
        })),
        videoTracks: this.localStream.getVideoTracks().map((t) => ({
          id: t.id.slice(0, 8), label: t.label, enabled: t.enabled,
          readyState: t.readyState, muted: t.muted,
        })),
        noiseCancellationEnabled: noiseCancellationService.getState().isEnabled,
      });
    } catch (err) {
      gcLog(userId, 'media ERROR', { error: String(err) });
      this.callbacks?.onError(err instanceof Error ? err.message : 'Media access denied');
      return false;
    }

    return this.connectSignaling(roomId, userId);
  }

  leaveGroupCall(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'leave', payload: {} }));
      this.ws.close();
    }
    this.teardown();
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

  // ── Accessors ─────────────────────────────────────────────────────────────

  get isInGroupCallState(): boolean { return this.inCall; }
  get currentRoomIdState(): string { return this.currentRoomId; }
  get localStreamState(): MediaStream | null { return this.localStream; }
  get peerCount(): number { return this.remoteStreams.size; }

  // ── Private: media acquisition ────────────────────────────────────────────

  private async acquireMedia(): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    } catch {
      // Fall back to audio-only if camera is unavailable.
      return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
  }

  // ── Private: signaling connection ─────────────────────────────────────────

  private connectSignaling(roomId: string, userId: string): Promise<boolean> {
    const url = `${SFU_URL}/ws?user_id=${userId}&room_id=${roomId}`;
    this.ws = new WebSocket(url);

    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const settle = (v: boolean) => { if (!resolved) { resolved = true; resolve(v); } };

      this.ws!.onopen = () => {
        gcLog(userId, 'WS connected', { url });
        // The server creates the PC on its side upon WS upgrade — no explicit join message needed.
        // The server will immediately send us an "offer".
      };

      this.ws!.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as SignalingMessage;
        gcLog(userId, 'WS message', { type: msg.type });
        if (msg.type === 'joined') {
          this.inCall = true;
          const joined = msg.payload as JoinedPayload;
          gcLog(userId, 'joined room', { existingPeers: joined.existing_peers ?? [] });
          // Notify the UI about participants who are already in the room.
          joined.existing_peers?.forEach((uid) => this.callbacks?.onPeerJoined(uid));
          this.ws!.onmessage = (ev) => {
            const m = JSON.parse(ev.data as string) as SignalingMessage;
            gcLog(userId, 'WS message', { type: m.type });
            void this.handleMessage(m);
          };
          settle((joined.existing_peers?.length ?? 0) === 0);
        } else {
          // Server may send an offer before 'joined' arrives — handle immediately.
          void this.handleMessage(msg);
        }
      };

      this.ws!.onclose = (ev) => {
        gcLog(userId, 'WS closed', { code: ev.code, reason: ev.reason });
        settle(false);
        this.inCall = false;
        this.callbacks?.onCallEnded();
        this.teardown();
      };

      this.ws!.onerror = () => {
        gcLog(userId, 'WS ERROR');
        settle(false);
        this.callbacks?.onError('SFU connection failed');
      };
    });
  }

  // ── Private: PeerConnection creation ─────────────────────────────────────

  private createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
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
    const addedTracks: Array<Record<string, unknown>> = [];
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track);
        addedTracks.push({
          kind: track.kind,
          id: track.id.slice(0, 8),
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
          label: track.label,
        });
      }
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

    pc.ontrack = (event) => {
      // pion sets streamID = publisher's userID — use it as the key.
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
      });

      if (streamId === this.currentUserId) {
        gcLog(this.currentUserId, 'ontrack BLOCKED by echo guard', { streamId: streamId.slice(0, 8) });
        return;
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

    // Monitor local audio track state every 2s while connected — helps detect
    // track going muted/ended after ICE connection (e.g. suspended AudioContext).
    const audioMonitorId = setInterval(() => {
      if (!this.localStream || !this.pc) {
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
      gcLog(this.currentUserId, 'audio track monitor', {
        trackEnabled: audioTrack.enabled,
        trackMuted: audioTrack.muted,
        trackReadyState: audioTrack.readyState,
        pcConnectionState: this.pc.connectionState,
        senderHasTrack: audioSender?.track !== null,
        senderTrackMuted: audioSender?.track?.muted ?? null,
        senderTrackReadyState: audioSender?.track?.readyState ?? null,
      });
      if (this.pc.connectionState === 'connected') {
        // Stop monitoring once we've confirmed connection (log a few times then stop).
        clearInterval(audioMonitorId);
      }
    }, 2000);

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
        this.callbacks?.onError('WebRTC connection failed');
      }
    };

    pc.onsignalingstatechange = () => {
      gcLog(this.currentUserId, 'PC signalingState', { state: pc.signalingState });
    };

    pc.onicegatheringstatechange = () => {
      gcLog(this.currentUserId, 'ICE gatheringState', { state: pc.iceGatheringState });
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
        this.callbacks?.onError((msg.payload as ErrorPayload).message);
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

    // Local tracks were added in createPeerConnection() via addTrack.
    // Chrome already matched them to the offer's recvonly m-sections — no manual
    // track attachment needed here. For renegotiation offers (server adding forwarded
    // tracks), the existing upload transceivers keep their tracks automatically.

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
    gcLog(this.currentUserId, 'teardown', {
      remoteStreams: this.remoteStreams.size,
      pcState: this.pc?.connectionState ?? 'null',
    });
    this.pc?.close();
    this.pc = null;

    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;

    this.remoteStreams.clear();
    this.pendingCandidates = [];
    this.inCall = false;
    this.ws = null;
  }
}

export const groupCallService = new GroupCallService();
