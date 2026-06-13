import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { callService } from '@/services/call';
import { audioService } from '@/services/audio';
import { wsService } from '@/services/websocket';
import './CallUI.css';

function useIsSpeaking(stream: MediaStream | null, isMuted: boolean): boolean {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!stream || isMuted) {
      setSpeaking(false);
      return;
    }

    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    let rafId = 0;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setSpeaking(avg / 128 > 0.05);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      source.disconnect();
      ctx.close();
    };
  }, [stream, isMuted]);

  return speaking;
}

function useMicLevel(stream: MediaStream | null, isMuted: boolean): number {
  const [level, setLevel] = useState(0);
  const rafRef = useRef(0);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!stream || isMuted) {
      setLevel(0);
      return;
    }

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    ctxRef.current = ctx;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setLevel(avg / 128); // 0–1, normalised
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      source.disconnect();
      ctx.close();
    };
  }, [stream, isMuted]);

  return level;
}

export function CallUI() {
  const { user } = useAuthStore();
  const [incomingCall, setIncomingCall] = useState<{ call_id: string; caller_id: string } | null>(null);
  const [activeCall, setActiveCall] = useState<{ call_id: string } | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isMicAvailable, setIsMicAvailable] = useState(true);
  const [isVideoOff, setIsVideoOff] = useState(true);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const micLevel = useMicLevel(
    activeCall ? callService.localStreamState : null,
    isMuted,
  );
  const remoteIsSpeaking = useIsSpeaking(activeCall ? remoteStream : null, remoteMuted);
  const [error, setError] = useState<string | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    callService.init({
      onRemoteStream: (stream) => {
        setRemoteStream(stream);
        if (localVideoRef.current && callService.localStreamState) {
          localVideoRef.current.srcObject = callService.localStreamState;
        }
      },
      onCallEnded: () => {
        audioService.stopRingtone();
        audioService.playCallEnded();
        setActiveCall(null);
        setIncomingCall(null);
        setRemoteStream(null);
        setIsMuted(false);
        setIsMicAvailable(true);
        setIsVideoOff(false);
        setRemoteMuted(false);
      },
      onError: (msg) => {
        audioService.stopRingtone();
        setError(msg);
        setTimeout(() => setError(null), 5000);
      },
    });

    const handleIncoming = (e: CustomEvent) => {
      setIncomingCall(e.detail);
      try { audioService.startRingtone(); } catch (_) {}
    };
    window.addEventListener('discrod:incoming_call', handleIncoming as EventListener);

    const handleCallStarted = (e: CustomEvent) => {
      audioService.stopRingtone();
      audioService.playCallAccepted();
      setActiveCall(e.detail);
      setIncomingCall(null);
      const micAvailable = callService.isMicrophoneAvailable;
      setIsMicAvailable(micAvailable);
      if (!micAvailable) setIsMuted(true);
    };
    window.addEventListener('discrod:call_started', handleCallStarted as EventListener);

    const handleCallRejected = () => {
      audioService.stopRingtone();
      audioService.playBusy();
      setIncomingCall(null);
    };
    window.addEventListener('discrod:call_rejected', handleCallRejected);

    const unsubMuted = wsService.on('mic_muted', (payload) => {
      const p = payload as { user_id: string };
      if (p.user_id !== user?.id) setRemoteMuted(true);
    });

    const unsubUnmuted = wsService.on('mic_unmuted', (payload) => {
      const p = payload as { user_id: string };
      if (p.user_id !== user?.id) setRemoteMuted(false);
    });

    return () => {
      window.removeEventListener('discrod:incoming_call', handleIncoming as EventListener);
      window.removeEventListener('discrod:call_started', handleCallStarted as EventListener);
      window.removeEventListener('discrod:call_rejected', handleCallRejected);
      unsubMuted();
      unsubUnmuted();
    };
  }, [user?.id]);

  const handleAcceptCall = useCallback(async () => {
    await callService.acceptCall();
    const micAvailable = callService.isMicrophoneAvailable;
    setIsMicAvailable(micAvailable);
    if (!micAvailable) {
      setIsMuted(true);
      wsService.send('mic_muted', {});
    } else {
      wsService.send('mic_unmuted', {});
    }
    if (incomingCall) {
      setActiveCall({ call_id: incomingCall.call_id });
    }
    setIncomingCall(null);
  }, [incomingCall]);

  const handleRejectCall = () => {
    callService.rejectCall();
    setIncomingCall(null);
  };

  const handleEndCall = () => {
    callService.endCall();
    setActiveCall(null);
  };

  const handleToggleMute = () => {
    const muted = callService.toggleMuteAudio();
    setIsMuted(muted);
    wsService.send(muted ? 'mic_muted' : 'mic_unmuted', {});
  };

  const handleToggleVideo = () => {
    const off = callService.toggleMuteVideo();
    setIsVideoOff(off);
  };

  useEffect(() => {
    if (activeCall && localVideoRef.current && callService.localStreamState) {
      localVideoRef.current.srcObject = callService.localStreamState;
    }
  }, [activeCall]);

  // Attach remote stream after video element is mounted
  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, activeCall]);

  // If no active call or incoming call, don't render anything
  if (!activeCall && !incomingCall) {
    return null;
  }

  return (
    <>
      {/* Incoming Call Modal */}
      {incomingCall && (
        <div className="call-overlay incoming">
          <div className="call-modal">
            <div className="call-avatar incoming-avatar">📞</div>
            <h2>Incoming Call</h2>
            <p>User is calling you...</p>
            <div className="call-actions">
              <button className="call-btn reject" onClick={handleRejectCall}>
                ✕
              </button>
              <button className="call-btn accept" onClick={handleAcceptCall}>
                ✓
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Call Overlay */}
      {activeCall && (
        <div className="call-overlay active">
          <div className="call-videos">
            <div className={`remote-video ${remoteIsSpeaking ? 'speaking' : ''}`}>
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
              />
              {(remoteMuted || remoteIsSpeaking) && (
                <div className="remote-mic-status">
                  {remoteMuted
                    ? <span className="mic-status-icon">🔇</span>
                    : <span className="mic-dot" />
                  }
                </div>
              )}
              <div className="call-timer">
                <CallTimer />
              </div>
            </div>
            <div className={`local-video ${micLevel > 0.05 ? 'speaking' : ''}`}>
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
              />
              {user && (
                <div className="local-video-label">
                  {!isMicAvailable
                    ? <span className="mic-status-icon">🚫</span>
                    : isMuted
                      ? <span className="mic-status-icon">🔇</span>
                      : (micLevel > 0.05 ? <span className="mic-dot" /> : null)
                  }
                  {user.username} (You)
                </div>
              )}
            </div>
          </div>

          <div className="call-controls">
            <div
              className="mic-btn-wrap"
              style={{ '--mic-level': micLevel } as React.CSSProperties}
            >
              <button
                className={`control-btn ${isMuted ? 'active' : ''}`}
                onClick={handleToggleMute}
                disabled={!isMicAvailable}
                title={!isMicAvailable ? 'Микрофон недоступен' : isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
              >
                {!isMicAvailable ? '🚫' : isMuted ? '🔇' : '🎤'}
              </button>
            </div>
            <button
              className={`control-btn ${isVideoOff ? 'active' : ''}`}
              onClick={handleToggleVideo}
              title={isVideoOff ? 'Turn on camera' : 'Turn off camera'}
            >
              {isVideoOff ? '📷' : '🎥'}
            </button>
            <button className="control-btn end-call" onClick={handleEndCall} title="End call">
              📞
            </button>
          </div>
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div className="error-toast">
          {error}
        </div>
      )}
    </>
  );
}

function CallTimer() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return (
    <span>
      {mins.toString().padStart(2, '0')}:{secs.toString().padStart(2, '0')}
    </span>
  );
}
