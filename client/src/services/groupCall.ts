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
  private callbacks: GroupCallCallbacks | null = null;
  private ws: WebSocket | null = null;
  private currentUserId: string = '';
  private currentRoomId: string = '';
  private isInGroupCall = false;

  init(callbacks: GroupCallCallbacks): void {
    this.callbacks = callbacks;
  }

  async joinGroupCall(roomId: string, userId: string): Promise<void> {
    if (this.isInGroupCall) {
      this.callbacks?.onError('Already in a group call');
      return;
    }

    this.currentUserId = userId;
    this.currentRoomId = roomId;

    try {
      // Get local media; fall back to audio-only if camera is busy or unavailable
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true,
        });
      } catch {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      }

      // Connect to SFU
      const wsUrl = `${SFU_URL}/ws?user_id=${userId}&room_id=${roomId}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        // Join the room
        this.ws?.send(JSON.stringify({
          type: 'join',
          payload: { room_id: roomId, user_id: userId },
        }));
        this.isInGroupCall = true;
      };

      this.ws.onmessage = (event) => {
        this.handleSFUMessage(event.data);
      };

      this.ws.onclose = () => {
        this.isInGroupCall = false;
        this.callbacks?.onCallEnded();
        this.cleanup();
      };

      this.ws.onerror = () => {
        this.callbacks?.onError('SFU connection failed');
      };
    } catch (err) {
      this.callbacks?.onError(err instanceof Error ? err.message : 'Failed to join group call');
    }
  }

  leaveGroupCall(): void {
    if (this.ws) {
      this.ws.send(JSON.stringify({ type: 'leave', payload: {} }));
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
        this.callbacks?.onPeerJoined(msg.payload.user_id);
        // Create peer connection for new peer
        await this.createPeerForUser(msg.payload.user_id);
        break;

      case 'peer_left':
        this.removePeer(msg.payload.user_id);
        this.callbacks?.onPeerLeft(msg.payload.user_id);
        break;

      case 'offer':
        await this.handleOffer(msg.payload);
        break;

      case 'answer':
        await this.handleAnswer(msg.payload);
        break;

      case 'ice_candidate':
        await this.handleICECandidate(msg.payload);
        break;
    }
  }

  private async createPeerForUser(userId: string): Promise<void> {
    if (this.remotePeers.has(userId)) return;

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    const remoteStream = new MediaStream();

    pc.ontrack = (event) => {
      remoteStream.addTrack(event.track);
      this.callbacks?.onRemoteStream(userId, remoteStream);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && this.ws) {
        this.ws.send(JSON.stringify({
          type: 'ice_candidate',
          payload: {
            room_id: this.currentRoomId,
            user_id: this.currentUserId,
            candidate: event.candidate,
          },
        }));
      }
    };

    // Add local stream tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!);
      });
    }

    this.remotePeers.set(userId, {
      userId,
      stream: remoteStream,
      peerConnection: pc,
    });

    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.ws?.send(JSON.stringify({
      type: 'offer',
      payload: {
        room_id: this.currentRoomId,
        user_id: this.currentUserId,
        sdp: pc.localDescription,
      },
    }));
  }

  private async handleOffer(payload: { from_user_id: string; sdp: RTCSessionDescriptionInit }): Promise<void> {
    const { from_user_id, sdp } = payload;
    const peer = this.remotePeers.get(from_user_id);

    if (peer && peer.peerConnection) {
      await peer.peerConnection.setRemoteDescription(sdp);
      const answer = await peer.peerConnection.createAnswer();
      await peer.peerConnection.setLocalDescription(answer);

      this.ws?.send(JSON.stringify({
        type: 'answer',
        payload: {
          room_id: this.currentRoomId,
          user_id: this.currentUserId,
          sdp: peer.peerConnection.localDescription,
        },
      }));
    }
  }

  private async handleAnswer(payload: { from_user_id: string; sdp: RTCSessionDescriptionInit }): Promise<void> {
    const { from_user_id, sdp } = payload;
    const peer = this.remotePeers.get(from_user_id);

    if (peer && peer.peerConnection) {
      await peer.peerConnection.setRemoteDescription(sdp);
    }
  }

  private async handleICECandidate(payload: { from_user_id: string; candidate: RTCIceCandidateInit }): Promise<void> {
    const { from_user_id, candidate } = payload;
    const peer = this.remotePeers.get(from_user_id);

    if (peer && peer.peerConnection) {
      await peer.peerConnection.addIceCandidate(candidate);
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

    this.isInGroupCall = false;
  }

  get isInGroupCallState(): boolean {
    return this.isInGroupCall;
  }

  get localStreamState(): MediaStream | null {
    return this.localStream;
  }

  get peerCount(): number {
    return this.remotePeers.size;
  }
}

export const groupCallService = new GroupCallService();
