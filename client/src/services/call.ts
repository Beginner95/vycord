import { wsService } from './websocket';
import { noiseCancellationService } from './noiseCancellation';
import { getIceServers } from './iceConfig';

interface WebRTCCallbacks {
  onRemoteStream: (stream: MediaStream) => void;
  onCallEnded: () => void;
  onError: (error: string) => void;
}

class CallService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private currentCallId: string | null = null;
  private remoteUserId: string | null = null;
  private isInCall = false;
  private _microphoneAvailable = false;
  private callbacks: WebRTCCallbacks | null = null;
  private pendingOffer: RTCSessionDescriptionInit | null = null;
  private callAccepted = false;

  init(callbacks: WebRTCCallbacks): void {
    this.callbacks = callbacks;

    // Listen for WebRTC messages
    wsService.on('incoming_call', this.handleIncomingCall);
    wsService.on('call_started', this.handleCallStarted);
    wsService.on('call_accepted', this.handleCallAccepted);
    wsService.on('call_rejected', this.handleCallRejected);
    wsService.on('call_ended', this.handleCallEnded);
    wsService.on('webrtc_offer', this.handleWebRTCOffer);
    wsService.on('webrtc_answer', this.handleWebRTCAnswer);
    wsService.on('webrtc_ice_candidate', this.handleWebRTCICECandidate);
    wsService.on('error', this.handleError);
  }

  async startCall(receiverId: string): Promise<string | null> {
    try {
      this.remoteUserId = receiverId;
      this._microphoneAvailable = false;

      // Get local media stream; fall back to audio-only, then video-only, then nothing
      try {
        let rawStream: MediaStream;
        try {
          rawStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        } catch {
          rawStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        }
        this.localStream = await noiseCancellationService.applyToStream(rawStream);
        this.localStream.getVideoTracks().forEach((t) => { t.enabled = false; });
        this._microphoneAvailable = this.localStream.getAudioTracks().length > 0;
      } catch {
        // No audio device — try video-only, or proceed without local media
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
          this.localStream.getVideoTracks().forEach((t) => { t.enabled = false; });
        } catch {
          this.localStream = null;
        }
      }

      // Create peer connection
      await this.createPeerConnection();

      // Add local stream tracks (if any)
      if (this.localStream) {
        this.localStream.getTracks().forEach((track) => {
          this.peerConnection!.addTrack(track, this.localStream!);
        });
      }

      // Create offer
      const offer = await this.peerConnection!.createOffer();
      await this.peerConnection!.setLocalDescription(offer);

      // Signal call start
      wsService.send('call_start', { receiver_id: receiverId });

      return new Promise((resolve) => {
        const checkCallId = setInterval(() => {
          if (this.currentCallId) {
            clearInterval(checkCallId);

            // Send offer
            wsService.send('webrtc_offer', {
              target_user_id: receiverId,
              sdp: this.peerConnection!.localDescription,
            });

            resolve(this.currentCallId);
          }
        }, 100);

        // Timeout after 30s
        setTimeout(() => {
          clearInterval(checkCallId);
          resolve(null);
        }, 30000);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start call';
      this.callbacks?.onError(message);
      return null;
    }
  }

  async acceptCall(): Promise<void> {
    if (!this.localStream) {
      this._microphoneAvailable = false;
      try {
        let rawStream: MediaStream;
        try {
          rawStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        } catch {
          rawStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        }
        this.localStream = await noiseCancellationService.applyToStream(rawStream);
        this.localStream.getVideoTracks().forEach((t) => { t.enabled = false; });
        this._microphoneAvailable = this.localStream.getAudioTracks().length > 0;
      } catch {
        // No audio device — try video-only, or proceed without local media
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
          this.localStream.getVideoTracks().forEach((t) => { t.enabled = false; });
        } catch {
          this.localStream = null;
        }
      }
    }

    await this.createPeerConnection();

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        this.peerConnection!.addTrack(track, this.localStream!);
      });
    }

    this.callAccepted = true;

    if (this.currentCallId) {
      wsService.send('call_accept', { call_id: this.currentCallId });
    }

    // If offer arrived before peer connection was ready it's stored in pendingOffer.
    // If offer arrives after this point, handleWebRTCOffer will send the answer directly.
    if (this.pendingOffer) {
      await this.sendAnswer(this.pendingOffer);
      this.pendingOffer = null;
    }
  }

  private async sendAnswer(offerSdp: RTCSessionDescriptionInit): Promise<void> {
    await this.peerConnection!.setRemoteDescription(offerSdp);
    const answer = await this.peerConnection!.createAnswer();
    await this.peerConnection!.setLocalDescription(answer);
    wsService.send('webrtc_answer', {
      target_user_id: this.remoteUserId ?? '',
      sdp: this.peerConnection!.localDescription,
    });
  }

  rejectCall(): void {
    if (this.currentCallId) {
      wsService.send('call_reject', { call_id: this.currentCallId });
    }
    this.cleanup();
  }

  endCall(): void {
    if (this.currentCallId) {
      wsService.send('call_end', { call_id: this.currentCallId });
    }
    this.cleanup();
  }

  toggleMuteAudio(): boolean {
    if (!this.localStream) return false;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      return !audioTrack.enabled; // returns true if muted
    }
    return false;
  }

  toggleMuteVideo(): boolean {
    if (!this.localStream) return false;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      return !videoTrack.enabled; // returns true if muted
    }
    return false;
  }

  private async createPeerConnection(): Promise<void> {
    // STUN+TURN: TURN credentials are ephemeral and fetched per call — without
    // a relay, peers behind symmetric NAT/VPN never connect.
    this.peerConnection = new RTCPeerConnection({ iceServers: await getIceServers() });

    this.peerConnection.ontrack = (event) => {
      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
      }
      this.remoteStream.addTrack(event.track);
      this.callbacks?.onRemoteStream(this.remoteStream);
    };

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        wsService.send('webrtc_ice_candidate', {
          target_user_id: this.remoteUserId ?? '',
          candidate: event.candidate,
        });
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      if (
        this.peerConnection?.connectionState === 'disconnected' ||
        this.peerConnection?.connectionState === 'failed'
      ) {
        this.callbacks?.onCallEnded();
        this.cleanup();
      }
    };
  }

  private handleIncomingCall = (payload: unknown): void => {
    const data = payload as { call_id: string; caller_id: string };
    this.currentCallId = data.call_id;
    this.remoteUserId = data.caller_id;
  };

  private handleCallStarted = (payload: unknown): void => {
    const data = payload as { call_id: string };
    this.currentCallId = data.call_id;
    this.isInCall = true;
  };

  private handleCallAccepted = (): void => {
    this.isInCall = true;
  };

  private handleCallRejected = (): void => {
    this.cleanup();
    this.callbacks?.onError('Call was rejected');
  };

  private handleCallEnded = (): void => {
    this.cleanup();
    this.callbacks?.onCallEnded();
  };

  private handleWebRTCOffer = (payload: unknown): void => {
    const data = payload as { from_user_id: string; sdp: RTCSessionDescriptionInit };

    if (!this.remoteUserId && data.from_user_id) {
      this.remoteUserId = data.from_user_id;
    }

    if (this.peerConnection && this.callAccepted) {
      // Ignore offers when not in stable state (glare scenario handling)
      if (this.peerConnection.signalingState !== 'stable') {
        return;
      }
      this.sendAnswer(data.sdp).catch(console.error);
    } else {
      // acceptCall hasn't finished setting up yet; offer will be processed there
      this.pendingOffer = data.sdp;
    }
  };

  private handleWebRTCAnswer = (payload: unknown): void => {
    const data = payload as { from_user_id: string; sdp: RTCSessionDescriptionInit };
    if (this.peerConnection && this.peerConnection.signalingState === 'have-local-offer') {
      this.peerConnection.setRemoteDescription(data.sdp).catch(console.error);
    }
  };

  private handleWebRTCICECandidate = (payload: unknown): void => {
    const data = payload as { from_user_id: string; candidate: RTCIceCandidateInit };
    if (this.peerConnection && this.peerConnection.remoteDescription) {
      this.peerConnection.addIceCandidate(data.candidate).catch(console.error);
    }
  };

  private handleError = (payload: unknown): void => {
    const data = payload as { message: string };
    this.callbacks?.onError(data.message);
  };

  private cleanup(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.remoteStream = null;
    this.currentCallId = null;
    this.remoteUserId = null;
    this.isInCall = false;
    this._microphoneAvailable = false;
    this.pendingOffer = null;
    this.callAccepted = false;
  }

  get isInCallState(): boolean {
    return this.isInCall;
  }

  get localStreamState(): MediaStream | null {
    return this.localStream;
  }

  get isMicrophoneAvailable(): boolean {
    return this._microphoneAvailable;
  }
}

export const callService = new CallService();
