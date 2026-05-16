import { noiseCancellationService } from './noiseCancellation';

const SFU_URL = import.meta.env.VITE_SFU_URL || 'ws://localhost:8081';

interface GroupCallCallbacks {
  onRemoteStream: (userId: string, stream: MediaStream) => void;
  onPeerJoined: (userId: string) => void;
  onPeerLeft: (userId: string) => void;
  onCallEnded: () => void;
  onError: (error: string) => void;
}

interface RemotePeer {
  userId: string;
  stream: MediaStream | null;
  peerConnection: RTCPeerConnection | null;
}

class GroupCallService {
  private localStream: MediaStream | null = null;
  private remotePeers: Map<string, RemotePeer> = new Map();
  private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
  private callbacks: GroupCallCallbacks | null = null;
  private ws: WebSocket | null = null;
  private currentUserId: string = '';
  private currentRoomId: string = '';
  private isInGroupCall = false;

  init(callbacks: GroupCallCallbacks): void {
    this.callbacks = callbacks;
  }

  async joinGroupCall(roomId: string, userId: string): Promise<boolean> {
    if (this.isInGroupCall) {
      this.callbacks?.onError('Already in a group call');
      return false;
    }

    this.currentUserId = userId;
    this.currentRoomId = roomId;

    let rawStream: MediaStream;
    try {
      try {
        rawStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } catch {
        rawStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      }
    } catch (err) {
      this.callbacks?.onError(err instanceof Error ? err.message : 'Failed to join group call');
      return false;
    }

    this.localStream = await noiseCancellationService.applyToStream(rawStream);
    this.localStream.getVideoTracks().forEach((t) => { t.enabled = false; });

    const wsUrl = `${SFU_URL}/ws?user_id=${userId}&room_id=${roomId}`;
    this.ws = new WebSocket(wsUrl);

    // Resolve with true if this user is the first in the room (no existing peers),
    // so the caller knows whether to send a ring notification.
    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const safeResolve = (value: boolean) => {
        if (!resolved) { resolved = true; resolve(value); }
      };

      this.ws!.onopen = () => {
        this.ws?.send(JSON.stringify({
          type: 'join',
          payload: { room_id: roomId, user_id: userId },
        }));
      };

      this.ws!.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);
        if (msg.type === 'joined') {
          this.isInGroupCall = true;
          const existingPeers: string[] = msg.payload?.existing_peers ?? [];
          // Switch to the normal message handler for all subsequent messages
          this.ws!.onmessage = (e) => { this.handleSFUMessage(e.data as string); };
          safeResolve(existingPeers.length === 0);
        } else {
          this.handleSFUMessage(event.data as string);
        }
      };

      this.ws!.onclose = () => {
        safeResolve(false);
        this.isInGroupCall = false;
        this.callbacks?.onCallEnded();
        this.cleanup();
      };

      this.ws!.onerror = () => {
        safeResolve(false);
        this.callbacks?.onError('SFU connection failed');
      };
    });
  }

  leaveGroupCall(): void {
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'leave', payload: {} }));
      }
      this.ws.close();
    }
    this.cleanup();
  }

  toggleMuteAudio(): boolean {
    if (!this.localStream) return false;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      return !audioTrack.enabled;
    }
    return false;
  }

  toggleMuteVideo(): boolean {
    if (!this.localStream) return false;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      return !videoTrack.enabled;
    }
    return false;
  }

  private async handleSFUMessage(data: string): Promise<void> {
    const msg = JSON.parse(data);

    switch (msg.type) {
      case 'joined':
        console.log('[GroupCall] Joined room:', msg.payload.room_id);
        break;

      case 'peer_joined':
        console.log('[GroupCall] peer_joined received:', msg.payload.user_id);
        console.log('[GroupCall] current remotePeers size:', this.remotePeers.size);
        this.callbacks?.onPeerJoined(msg.payload.user_id);
        console.log('[GroupCall] creating peer for:', msg.payload.user_id);
        await this.createPeerForUser(msg.payload.user_id);
        console.log('[GroupCall] after createPeerForUser, remotePeers size:', this.remotePeers.size);
        break;

      case 'peer_left':
        this.removePeer(msg.payload.user_id);
        this.callbacks?.onPeerLeft(msg.payload.user_id);
        break;

      case 'offer':
        console.log('[GroupCall] offer received from:', msg.payload.from_user_id);
        await this.handleOffer(msg.payload);
        console.log('[GroupCall] offer handling complete');
        break;

      case 'answer':
        console.log('[GroupCall] answer received from:', msg.payload.from_user_id);
        await this.handleAnswer(msg.payload);
        console.log('[GroupCall] answer handling complete');
        break;

      case 'ice_candidate':
        console.log('[GroupCall] ice_candidate received from:', msg.payload.from_user_id);
        await this.handleICECandidate(msg.payload);
        console.log('[GroupCall] ice_candidate handling complete');
        break;
    }
  }

  private createPeerConnection(userId: string): RTCPeerConnection {
    console.log('[GroupCall] createPeerConnection called for:', userId);
    const remoteStream = new MediaStream();

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    pc.ontrack = (event) => {
      console.log('[GroupCall] ontrack fired for', userId, 'track:', event.track.kind);
      remoteStream.addTrack(event.track);
      this.callbacks?.onRemoteStream(userId, remoteStream);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && this.ws) {
        console.log('[GroupCall] ICE candidate generated for', userId, ':', event.candidate.candidate?.substring(0, 50));
        this.ws.send(JSON.stringify({
          type: 'ice_candidate',
          payload: {
            room_id: this.currentRoomId,
            user_id: this.currentUserId,
            target_user_id: userId,
            candidate: event.candidate,
          },
        }));
      } else if (event.candidate) {
        console.log('[GroupCall] ICE candidate for', userId, 'but ws not ready');
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[GroupCall] ICE connection state for', userId, ':', pc.iceConnectionState, 'signalingState:', pc.signalingState);
    };

    pc.onconnectionstatechange = () => {
      console.log('[GroupCall] PC connection state for', userId, ':', pc.connectionState, 'signalingState:', pc.signalingState);
    };

    pc.onsignalingstatechange = () => {
      console.log('[GroupCall] PC signaling state changed for', userId, ':', pc.signalingState, 'connectionState:', pc.connectionState);
    };

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!);
      });
      console.log('[GroupCall] added local tracks to PC for', userId);
    }

    this.remotePeers.set(userId, {
      userId,
      stream: remoteStream,
      peerConnection: pc,
    });

    console.log('[GroupCall] peer stored in remotePeers for:', userId, 'total:', this.remotePeers.size);
    return pc;
  }

  private async createPeerForUser(userId: string): Promise<void> {
    console.log('[GroupCall] createPeerForUser START for:', userId);
    if (this.remotePeers.has(userId)) {
      console.log('[GroupCall] peer already exists, skipping:', userId);
      return;
    }

    const pc = this.createPeerConnection(userId);

    console.log('[GroupCall] creating SDP offer for:', userId);
    const offer = await pc.createOffer();
    console.log('[GroupCall] SDP offer created, setting local description');
    await pc.setLocalDescription(offer);
    console.log('[GroupCall] local description set, sending offer via WS');

    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.error('[GroupCall] WebSocket not ready, cannot send offer to:', userId, 'readyState:', this.ws?.readyState);
      return;
    }

    this.ws.send(JSON.stringify({
      type: 'offer',
      payload: {
        room_id: this.currentRoomId,
        user_id: this.currentUserId,
        target_user_id: userId,
        sdp: pc.localDescription,
      },
    }));
    console.log('[GroupCall] offer sent successfully to SFU for:', userId);
  }

  private async handleOffer(payload: { from_user_id: string; sdp: RTCSessionDescriptionInit }): Promise<void> {
    const { from_user_id, sdp } = payload;
    console.log('[GroupCall] handleOffer: from', from_user_id, 'existing peer:', this.remotePeers.has(from_user_id));

    let peer = this.remotePeers.get(from_user_id);
    if (!peer || !peer.peerConnection) {
      console.log('[GroupCall] handleOffer: creating peer on-demand for', from_user_id);
      this.createPeerConnection(from_user_id);
      peer = this.remotePeers.get(from_user_id);
    }

    if (!peer?.peerConnection) {
      console.error('[GroupCall] handleOffer: peer or peerConnection is null for', from_user_id);
      return;
    }

    const pc = peer.peerConnection;
    console.log('[GroupCall] handleOffer: signalingState:', pc.signalingState);

    if (pc.signalingState !== 'stable') {
      console.warn('[GroupCall] handleOffer: skipping offer from', from_user_id, '— signalingState:', pc.signalingState);
      return;
    }

    await pc.setRemoteDescription(sdp);
    console.log('[GroupCall] handleOffer: remote description set for', from_user_id);

    // Apply any ICE candidates that arrived before remote description was ready
    await this.flushPendingCandidates(from_user_id, pc);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.error('[GroupCall] handleOffer: WebSocket not ready, cannot send answer');
      return;
    }

    this.ws.send(JSON.stringify({
      type: 'answer',
      payload: {
        room_id: this.currentRoomId,
        user_id: this.currentUserId,
        target_user_id: from_user_id,
        sdp: pc.localDescription,
      },
    }));
    console.log('[GroupCall] handleOffer: answer sent to', from_user_id, 'connectionState:', pc.connectionState);
  }

  private async handleAnswer(payload: { from_user_id: string; sdp: RTCSessionDescriptionInit }): Promise<void> {
    const { from_user_id, sdp } = payload;
    const peer = this.remotePeers.get(from_user_id);
    const state = peer?.peerConnection?.signalingState;
    console.log('[GroupCall] handleAnswer: from', from_user_id, 'signalingState:', state);

    if (!peer?.peerConnection) {
      console.warn('[GroupCall] handleAnswer: peer not found for', from_user_id);
      return;
    }

    const pc = peer.peerConnection;

    if (state !== 'have-local-offer') {
      console.warn('[GroupCall] handleAnswer: unexpected signalingState', state, 'for', from_user_id, '— ignoring answer');
      return;
    }

    try {
      await pc.setRemoteDescription(sdp);
      console.log('[GroupCall] handleAnswer: remote description set for', from_user_id, 'signalingState:', pc.signalingState);

      // Apply any ICE candidates that arrived before remote description was ready
      await this.flushPendingCandidates(from_user_id, pc);
    } catch (err) {
      console.error('[GroupCall] handleAnswer: failed to set remote description for', from_user_id, err);
    }
  }

  private async handleICECandidate(payload: { from_user_id: string; candidate: RTCIceCandidateInit }): Promise<void> {
    const { from_user_id, candidate } = payload;
    const peer = this.remotePeers.get(from_user_id);

    if (!peer?.peerConnection) {
      // Peer connection not created yet — buffer the candidate
      const buf = this.pendingCandidates.get(from_user_id) ?? [];
      buf.push(candidate);
      this.pendingCandidates.set(from_user_id, buf);
      console.log('[GroupCall] handleICECandidate: buffered candidate for', from_user_id, '(peer not ready), total buffered:', buf.length);
      return;
    }

    if (!peer.peerConnection.remoteDescription) {
      // Peer connection exists but remote description not set yet — buffer
      const buf = this.pendingCandidates.get(from_user_id) ?? [];
      buf.push(candidate);
      this.pendingCandidates.set(from_user_id, buf);
      console.log('[GroupCall] handleICECandidate: buffered candidate for', from_user_id, '(no remote desc), total buffered:', buf.length);
      return;
    }

    try {
      await peer.peerConnection.addIceCandidate(candidate);
    } catch (err) {
      console.warn('[GroupCall] handleICECandidate: failed to add candidate for', from_user_id, err);
    }
  }

  private async flushPendingCandidates(userId: string, pc: RTCPeerConnection): Promise<void> {
    const buffered = this.pendingCandidates.get(userId);
    if (!buffered?.length) return;

    console.log('[GroupCall] flushing', buffered.length, 'buffered ICE candidates for', userId);
    this.pendingCandidates.delete(userId);

    for (const candidate of buffered) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn('[GroupCall] failed to add buffered ICE candidate for', userId, err);
      }
    }
  }

  private removePeer(userId: string): void {
    const peer = this.remotePeers.get(userId);
    if (peer) {
      peer.peerConnection?.close();
      this.remotePeers.delete(userId);
    }
  }

  private cleanup(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    this.remotePeers.forEach((peer) => {
      peer.peerConnection?.close();
    });
    this.remotePeers.clear();
    this.pendingCandidates.clear();

    this.isInGroupCall = false;
  }

  get isInGroupCallState(): boolean {
    return this.isInGroupCall;
  }

  get currentRoomIdState(): string {
    return this.currentRoomId;
  }

  get localStreamState(): MediaStream | null {
    return this.localStream;
  }

  get peerCount(): number {
    return this.remotePeers.size;
  }
}

export const groupCallService = new GroupCallService();
