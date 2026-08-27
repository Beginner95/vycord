import { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { callService } from '@/services/call';
import { audioService } from '@/services/audio';
import { wsService } from '@/services/websocket';
import { useT } from '@/i18n';
import { useMicLevel } from '@/hooks/useMicLevel';
import { SPEAKING_THRESHOLD } from '@/utils/callStage';
import './CallUI.css';

export function CallUI() {
  const t = useT();
  const { user } = useAuthStore();
  const [incomingCall, setIncomingCall] = useState<{ call_id: string; caller_id: string } | null>(null);
  const [activeCall, setActiveCall] = useState<{ call_id: string } | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isMicAvailable, setIsMicAvailable] = useState(true);
  const [isVideoOff, setIsVideoOff] = useState(true);
  const [remoteMicMuted, setRemoteMicMuted] = useState(false);
  const micLevel = useMicLevel(
    activeCall ? callService.localStreamState : null,
    isMuted,
  );
  const remoteMicLevel = useMicLevel(
    activeCall ? remoteStream : null,
    remoteMicMuted,
  );
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
        setRemoteMicMuted(false);
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
      wsService.send(micAvailable ? 'mic_unmuted' : 'mic_muted', {});
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

  const handleAcceptCall = useCallback(async () => {
    await callService.acceptCall();
    const micAvailable = callService.isMicrophoneAvailable;
    setIsMicAvailable(micAvailable);
    if (!micAvailable) setIsMuted(true);
    wsService.send(micAvailable ? 'mic_unmuted' : 'mic_muted', {});
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

  // Listen for the remote peer's mic mute state via the main WS
  useEffect(() => {
    if (!activeCall) return;

    const unsubMuted = wsService.on('mic_muted', (payload) => {
      const p = payload as { user_id: string };
      if (p.user_id !== callService.remoteUserIdState) return;
      setRemoteMicMuted(true);
    });
    const unsubUnmuted = wsService.on('mic_unmuted', (payload) => {
      const p = payload as { user_id: string };
      if (p.user_id !== callService.remoteUserIdState) return;
      setRemoteMicMuted(false);
    });

    return () => { unsubMuted(); unsubUnmuted(); };
  }, [activeCall]);

  // If no active call or incoming call, don't render anything
  if (!activeCall && !incomingCall) {
    return null;
  }

  return (
    <>
      {/* Incoming Call Modal */}
      {incomingCall && (
        <div className="p2p-overlay is-incoming">
          <div className="p2p-modal">
            <div className="p2p-modal-tile">
              <Phone size={28} strokeWidth={1.8} />
            </div>
            <h2 className="p2p-modal-title">{t('call.incomingCall')}</h2>
            <p className="p2p-modal-sub">{t('call.userCalling')}</p>
            <div className="p2p-actions">
              <button
                className="p2p-reject-btn"
                onClick={handleRejectCall}
                aria-label={t('call.rejectCall')}
                title={t('call.rejectCall')}
              >
                <PhoneOff size={20} strokeWidth={1.8} />
              </button>
              <button
                className="p2p-accept-btn"
                onClick={handleAcceptCall}
                aria-label={t('call.acceptCall')}
                title={t('call.acceptCall')}
              >
                <Phone size={20} strokeWidth={1.8} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Call Overlay */}
      {activeCall && (
        <div className="p2p-overlay is-active">
          <div className="p2p-videos">
            <div
              className={`p2p-remote${remoteMicLevel > SPEAKING_THRESHOLD ? ' is-speaking' : ''}`}
              style={{ '--speak-level': Math.min(1, remoteMicLevel) } as React.CSSProperties}
            >
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
              />
              <div className="p2p-timer">
                <span className="p2p-timer-dot" />
                {t('call.live')} <CallTimer />
              </div>
              {remoteStream && (
                <div className="p2p-plate">
                  {remoteMicMuted
                    ? <span className="p2p-plate-mic is-muted"><MicOff size={12} strokeWidth={1.8} /></span>
                    : <span className="p2p-plate-mic"><Mic size={12} strokeWidth={1.8} /></span>}
                </div>
              )}
            </div>
            <div
              className={`p2p-local${micLevel > SPEAKING_THRESHOLD ? ' is-speaking' : ''}`}
              style={{ '--speak-level': Math.min(1, micLevel) } as React.CSSProperties}
            >
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
              />
              {user && (
                <div className="p2p-local-label">
                  {user.username} {t('call.youSuffix')}
                </div>
              )}
            </div>
          </div>

          <div className="p2p-controls">
            <div className="p2p-ctl">
              <button
                className={`p2p-ctl-btn${isMuted ? ' is-off' : ''}`}
                onClick={handleToggleMute}
                disabled={!isMicAvailable}
                title={!isMicAvailable ? t('call.micUnavailable') : isMuted ? t('call.micOn') : t('call.micOff')}
              >
                {isMuted ? <MicOff size={16} strokeWidth={1.8} /> : <Mic size={16} strokeWidth={1.8} />}
              </button>
              <span className="p2p-ctl-label">{t('call.ctlMic')}</span>
            </div>
            <div className="p2p-ctl">
              <button
                className={`p2p-ctl-btn${isVideoOff ? ' is-off' : ''}`}
                onClick={handleToggleVideo}
                title={isVideoOff ? t('call.cameraOn') : t('call.cameraOff')}
              >
                {isVideoOff ? <VideoOff size={16} strokeWidth={1.8} /> : <Video size={16} strokeWidth={1.8} />}
              </button>
              <span className="p2p-ctl-label">{t('call.ctlCamera')}</span>
            </div>
            <div className="p2p-ctl-divider" />
            <button className="p2p-leave-btn" onClick={handleEndCall} title={t('call.endCall')}>
              <PhoneOff size={16} strokeWidth={1.8} />
              {t('call.leaveLabel')}
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
