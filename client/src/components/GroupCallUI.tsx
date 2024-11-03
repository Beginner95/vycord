import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { groupCallService } from '@/services/groupCall';
import './GroupCallUI.css';

interface RemoteParticipant {
  userId: string;
  stream: MediaStream | null;
}

export function GroupCallUI() {
  const { user } = useAuthStore();
  const [isInGroupCall, setIsInGroupCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  useEffect(() => {
    groupCallService.init({
      onRemoteStream: (userId, stream) => {
        setParticipants((prev) => {
          const exists = prev.find((p) => p.userId === userId);
          if (exists) {
            return prev.map((p) =>
              p.userId === userId ? { ...p, stream } : p
            );
          }
          return [...prev, { userId, stream }];
        });

        // Attach stream to video element
        const videoEl = remoteVideoRefs.current.get(userId);
        if (videoEl && videoEl.srcObject !== stream) {
          videoEl.srcObject = stream;
        }
      },
      onPeerJoined: (userId) => {
        setParticipants((prev) => {
          if (prev.find((p) => p.userId === userId)) return prev;
          return [...prev, { userId, stream: null }];
        });
      },
      onPeerLeft: (userId) => {
        setParticipants((prev) => prev.filter((p) => p.userId !== userId));
      },
      onCallEnded: () => {
        setIsInGroupCall(false);
        setParticipants([]);
        setIsMuted(false);
        setIsVideoOff(false);
      },
      onError: (msg) => {
        console.error('[GroupCall] Error:', msg);
        setIsInGroupCall(false);
      },
    });
  }, []);

  useEffect(() => {
    if (localVideoRef.current && groupCallService.localStreamState) {
      localVideoRef.current.srcObject = groupCallService.localStreamState;
    }
  }, [isInGroupCall]);

  const handleJoinGroupCall = useCallback(async (roomId: string) => {
    if (!user) return;
    await groupCallService.joinGroupCall(roomId, user.id);
    setIsInGroupCall(true);
  }, [user]);

  const handleLeaveGroupCall = useCallback(() => {
    groupCallService.leaveGroupCall();
    setIsInGroupCall(false);
    setParticipants([]);
  }, []);

  const handleToggleMute = useCallback(() => {
    const muted = groupCallService.toggleMuteAudio();
    setIsMuted(muted);
  }, []);

  const handleToggleVideo = useCallback(() => {
    const off = groupCallService.toggleMuteVideo();
    setIsVideoOff(off);
  }, []);

  // Expose joinGroupCall to window for other components
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.joinGroupCall = handleJoinGroupCall;
    w.leaveGroupCall = handleLeaveGroupCall;
  }, [handleJoinGroupCall, handleLeaveGroupCall]);

  if (!isInGroupCall) return null;

  return (
    <div className="group-call-overlay">
      <div className="group-call-header">
        <h2>Group Call</h2>
        <span className="participant-count">{participants.length + 1} participants</span>
      </div>

      <div className="video-grid">
        {/* Local video */}
        <div className={`video-tile ${isVideoOff ? 'video-off' : ''}`}>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
          />
          {isVideoOff && <div className="video-off-placeholder">📷</div>}
          <div className="video-label">
            {user?.username} (You)
          </div>
        </div>

        {/* Remote videos */}
        {participants.map((p) => (
          <div key={p.userId} className={`video-tile ${!p.stream ? 'video-off' : ''}`}>
            <video
              ref={(el) => {
                if (el) remoteVideoRefs.current.set(p.userId, el);
              }}
              autoPlay
              playsInline
            />
            {!p.stream && <div className="video-off-placeholder">📷</div>}
            <div className="video-label">
              {p.userId.slice(0, 8)}
            </div>
          </div>
        ))}
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
        <button className="control-btn end-call" onClick={handleLeaveGroupCall} title="Leave call">
          📞
        </button>
      </div>
    </div>
  );
}
