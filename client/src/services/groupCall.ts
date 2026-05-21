import { noiseCancellationService } from './noiseCancellation';

const SFU_URL = import.meta.env.VITE_SFU_URL || 'ws://localhost:8081';

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
    } catch (err) {
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
        // The server creates the PC on its side upon WS upgrade — no explicit join message needed.
        // The server will immediately send us an "offer".
      };

      this.ws!.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as SignalingMessage;
        if (msg.type === 'joined') {
          this.inCall = true;
          const joined = msg.payload as JoinedPayload;
          // Notify the UI about participants who are already in the room.
          joined.existing_peers?.forEach((uid) => this.callbacks?.onPeerJoined(uid));
          this.ws!.onmessage = (ev) => {
            void this.handleMessage(JSON.parse(ev.data as string) as SignalingMessage);
          };
          settle((joined.existing_peers?.length ?? 0) === 0);
        } else {
          // Server may send an offer before 'joined' arrives — handle immediately.
          void this.handleMessage(msg);
        }
      };

      this.ws!.onclose = () => {
        settle(false);
        this.inCall = false;
        this.callbacks?.onCallEnded();
        this.teardown();
      };

      this.ws!.onerror = () => {
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

    // Publish local media as sendonly streams.
    // Using addTransceiver (sendonly) avoids the SFU needing to echo tracks back.
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTransceiver(track, { direction: 'sendonly', streams: [this.localStream] });
      }
    }

    pc.ontrack = (event) => {
      // pion sets streamID = publisher's userID — use it as the key.
      const streamId = event.streams[0]?.id ?? event.track.id;
      if (streamId === this.currentUserId) return; // echo guard

      let stream = this.remoteStreams.get(streamId);
      if (!stream) {
        stream = event.streams[0] ?? new MediaStream();
        this.remoteStreams.set(streamId, stream);
      }
      if (!stream.getTrackById(event.track.id)) {
        stream.addTrack(event.track);
      }
      this.callbacks?.onRemoteStream(streamId, stream);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'ice_candidate',
          payload: event.candidate.toJSON(),
        }));
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        this.callbacks?.onError('WebRTC connection failed');
      }
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
    // Server-initiated offer: create PC on first offer, reuse on renegotiation.
    if (!this.pc) {
      this.pc = this.createPeerConnection();
    }

    try {
      await this.pc.setRemoteDescription({ type: payload.type, sdp: payload.sdp });
    } catch (err) {
      console.error('[GroupCall] setRemoteDescription failed:', err);
      // PC stays in stable — server will timeout and rollback on its side.
      return;
    }

    // Flush any ICE candidates that arrived before remote description.
    for (const c of this.pendingCandidates) {
      await this.pc.addIceCandidate(c).catch(() => { /* stale candidate */ });
    }
    this.pendingCandidates = [];

    let answer: RTCSessionDescriptionInit;
    try {
      answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
    } catch (err) {
      console.error('[GroupCall] createAnswer/setLocalDescription failed:', err);
      // PC is in have-remote-offer — rollback so future offers can be processed.
      await this.pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
      return;
    }

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
      this.pendingCandidates.push(init);
      return;
    }

    await this.pc.addIceCandidate(init).catch(() => { /* stale */ });
  }

  // ── Private: cleanup ──────────────────────────────────────────────────────

  private teardown(): void {
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
