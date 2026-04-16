import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { callService } from '@/services/call';
import { audioService } from '@/services/audio';
import './CallUI.css';

export function CallUI() {
  const { user } = useAuthStore();
  const [incomingCall, setIncomingCall] = useState<{ callId: string; callerId: string } | null>(null);
  const [activeCall, setActiveCall] = useState<{ callId: string } | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    callService.init({
      onRemoteStream: (stream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
        }
        if (localVideoRef.current && callService.localStreamState) {
          localVideoRef.current.srcObject = callService.localStreamState;
        }
      },
      onCallEnded: () => {
        audioService.stopRingtone();
        audioService.playCallEnded();
        setActiveCall(null);
        setIncomingCall(null);
        setIsMuted(false);
        setIsVideoOff(false);
      },
      onError: (msg) => {
        audioService.stopRingtone();
        setError(msg);
        setTimeout(() => setError(null), 5000);
      },
    });

    // Listen for incoming call events on WebSocket
    const handleIncoming = (e: CustomEvent) => {
      audioService.startRingtone();
      setIncomingCall(e.detail);
    };
    window.addEventListener('discrod:incoming_call', handleIncoming as EventListener);

    const handleCallStarted = (e: CustomEvent) => {
      audioService.stopRingtone();
      audioService.playCallAccepted();
      setActiveCall(e.detail);
      setIncomingCall(null);
    };
    window.addEventListener('discrod:call_started', handleCallStarted as EventListener);

    const handleCallRejected = () => {
      audioService.stopRingtone();
      audioService.playBusy();
      setIncomingCall(null);
    };
    window.addEventListener('discrod:call_rejected', handleCallRejected);

    return () => {
      window.removeEventListener('discrod:incoming_call', handleIncoming as EventListener);
      window.removeEventListener('discrod:call_started', handleCallStarted as EventListener);
      window.removeEventListener('discrod:call_rejected', handleCallRejected);
    };
  }, []);

  const handleAcceptCall = async () => {
    await callService.acceptCall();
    if (incomingCall) {
      setActiveCall({ callId: incomingCall.callId });
    }
    setIncomingCall(null);
  };

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
  };

  const handleToggleVideo = () => {
    const off = callService.toggleMuteVideo();
    setIsVideoOff(off);
  };

  // Show local stream as soon as call becomes active (don't wait for remote stream)
  useEffect(() => {
    if (activeCall && localVideoRef.current && callService.localStreamState) {
      localVideoRef.current.srcObject = callService.localStreamState;
    }
  }, [activeCall]);

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
            <div className="remote-video">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
              />
              <div className="call-timer">
                <CallTimer />
              </div>
            </div>
            <div className="local-video">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
              />
              {user && (
                <div className="local-video-label">
                  {user.username} (You)
                </div>
              )}
            </div>
          </div>

          <div className="call-controls">
            <button
              className={`control-btn ${isMuted ? 'active' : ''}`}
              onClick={handleToggleMute}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? '🔇' : '🎤'}
            </button>
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
