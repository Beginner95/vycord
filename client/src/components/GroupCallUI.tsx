import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { useMessageStore } from '@/stores/messageStore';
import { groupCallService } from '@/services/groupCall';
import { wsService } from '@/services/websocket';
import { apiService } from '@/services/api';
import type { User, Message } from '@/types';
import './GroupCallUI.css';

function useMicLevel(stream: MediaStream | null, isMuted: boolean): number {
  const [level, setLevel] = useState(0);
  const rafRef = useRef(0);

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

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setLevel(avg / 128);
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

interface RemoteParticipant {
  userId: string;
  stream: MediaStream | null;
}

// Attaches a remote MediaStream to a video element and starts playback.
//
// Autoplay policy problem: when ontrack fires for an audio-only or audio-first
// stream (B's case — A's audio+video arrive in a single SFU offer, audio ontrack
// may fire before video), Chrome blocks el.play() with NotAllowedError because
// the user gesture from "join call" click is expired by the time ICE+DTLS finishes.
//
// Fix: play muted first (always allowed), then immediately unmute. Chrome cannot
// block unmuting a playing element — audio starts as soon as muted becomes false.
// This is the standard cross-browser workaround used by WebRTC apps.
function attachStreamToElement(el: HTMLVideoElement, stream: MediaStream, userId: string): void {
  el.srcObject = stream;
  const audioTracks = stream.getAudioTracks();
  const videoTracks = stream.getVideoTracks();
  console.log(`[GC] attachStream uid=${userId.slice(0, 8)}`, {
    audioTracks: audioTracks.map((t) => ({ id: t.id.slice(0, 8), enabled: t.enabled, muted: t.muted, readyState: t.readyState })),
    videoTracks: videoTracks.map((t) => ({ id: t.id.slice(0, 8), enabled: t.enabled })),
    elMuted: el.muted,
    elVolume: el.volume,
    elPaused: el.paused,
    elReadyState: el.readyState,
  });

  // Mute temporarily so play() is guaranteed to succeed regardless of autoplay policy.
  el.muted = true;
  el.play()
    .then(() => {
      // Unmute immediately — browser cannot block this once the element is playing.
      el.muted = false;
      console.log(`[GC] attachStream: play+unmute succeeded uid=${userId.slice(0, 8)}`);
    })
    .catch((err) => {
      // Even muted play failed (e.g. element detached). Restore state.
      el.muted = false;
      console.warn(`[GC] el.play() failed uid=${userId.slice(0, 8)}:`, err);
    });
}

export function GroupCallUI() {
  const { user } = useAuthStore();
  const { currentServer, currentChannel } = useServerStore();
  const { messages, addMessage } = useMessageStore();
  const [isInGroupCall, setIsInGroupCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(true);
  const [showChat, setShowChat] = useState(true);
  const [chatInput, setChatInput] = useState('');
  const [userCache, setUserCache] = useState<Map<string, string>>(new Map());
  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

        // Attach stream to video element if it's already in the DOM.
        // The useEffect below is the fallback for when React re-renders first.
        const videoEl = remoteVideoRefs.current.get(userId);
        if (videoEl && videoEl.srcObject !== stream) {
          attachStreamToElement(videoEl, stream, userId);
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
        setParticipants([]);
        groupCallService.leaveGroupCall();
      },
    });
  }, []);

  useEffect(() => {
    if (localVideoRef.current && groupCallService.localStreamState) {
      localVideoRef.current.srcObject = groupCallService.localStreamState;
    }
  }, [isInGroupCall]);

  // Attach remote streams after React commits the video elements to DOM.
  // This is the primary attachment path — by the time this effect runs,
  // ref callbacks have already fired so remoteVideoRefs is populated.
  useEffect(() => {
    participants.forEach((p) => {
      if (p.stream) {
        const videoEl = remoteVideoRefs.current.get(p.userId);
        if (videoEl && videoEl.srcObject !== p.stream) {
          attachStreamToElement(videoEl, p.stream, p.userId);
        }
      }
    });
  }, [participants]);

  const handleJoinGroupCall = useCallback(async (roomId: string): Promise<boolean> => {
    if (!user) return false;
    const isFirst = await groupCallService.joinGroupCall(roomId, user.id);
    setIsInGroupCall(true);
    return isFirst;
  }, [user]);

  const handleLeaveGroupCall = useCallback(() => {
    const channelId = groupCallService.currentRoomIdState;
    if (channelId) {
      wsService.send('voice_call_cancel', {
        channel_id: channelId,
        server_id: currentServer?.id,
      });
    }
    groupCallService.leaveGroupCall();
    setIsInGroupCall(false);
    setParticipants([]);
  }, [currentServer]);

  const micLevel = useMicLevel(
    isInGroupCall ? groupCallService.localStreamState : null,
    isMuted,
  );

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const fetchUsernames = async () => {
      const userIds = new Set<string>();
      for (const msg of messages) {
        if (msg.user_id !== user?.id && !userCache.has(msg.user_id)) {
          userIds.add(msg.user_id);
        }
      }
      for (const p of participants) {
        if (p.userId !== user?.id && !userCache.has(p.userId)) {
          userIds.add(p.userId);
        }
      }
      for (const uid of userIds) {
        try {
          const fetched = await apiService.getUserById(uid) as User;
          setUserCache((prev) => new Map(prev).set(fetched.id, fetched.username));
        } catch {
          setUserCache((prev) => new Map(prev).set(uid, uid.slice(0, 8)));
        }
      }
    };
    if (messages.length > 0 || participants.length > 0) fetchUsernames();
  }, [messages, participants, user, userCache]);

  const handleSendMessage = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (!currentChannel || !chatInput.trim() || !user) return;
    try {
      const msg = await apiService.createMessage(currentChannel.id, chatInput.trim()) as Message;
      addMessage(msg);
      setChatInput('');
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  }, [currentChannel, chatInput, user, addMessage]);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!isInGroupCall) return null;

  const totalParticipants = participants.length + 1;
  const cols = Math.min(totalParticipants, 4);

  return (
    <div className="group-call-overlay">
      <div className="group-call-header">
        <h2>Group Call{currentChannel ? ` · #${currentChannel.name}` : ''}</h2>
        <span className="participant-count">{totalParticipants} participants</span>
      </div>

      <div className="call-body">
        <div className="video-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {/* Local video */}
          <div className={`video-tile ${isVideoOff ? 'video-off' : ''} ${micLevel > 0.05 ? 'speaking' : ''}`}>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="local-video"
            />
            {isVideoOff && <div className="video-off-placeholder">📷</div>}
            <div className="video-label">
              {!isMuted && micLevel > 0.05 && <span className="mic-dot" />}
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
                {userCache.get(p.userId) ?? p.userId.slice(0, 8)}
              </div>
            </div>
          ))}
        </div>

        {showChat && (
          <div className="call-chat">
            <div className="call-chat-header">
              <span>#{currentChannel?.name ?? 'Chat'}</span>
            </div>
            <div className="call-chat-messages">
              {messages.length === 0 ? (
                <p className="call-chat-empty">No messages yet</p>
              ) : (
                messages.map((msg) => {
                  const isFromMe = msg.user_id === user?.id;
                  const displayName = isFromMe
                    ? user!.username
                    : (userCache.get(msg.user_id) ?? msg.user_id.slice(0, 8));
                  return (
                    <div key={msg.id} className={`call-chat-msg ${isFromMe ? 'self' : ''}`}>
                      <span className="call-chat-author">{displayName}</span>
                      <span className="call-chat-time">{formatTime(msg.created_at)}</span>
                      <p className="call-chat-text">{msg.content}</p>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>
            <form className="call-chat-input" onSubmit={handleSendMessage}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={`Message #${currentChannel?.name ?? 'channel'}`}
                maxLength={2000}
              />
              <button type="submit" disabled={!chatInput.trim()}>Send</button>
            </form>
          </div>
        )}
      </div>

      <div className="call-controls">
        <div
          className="mic-btn-wrap"
          style={{ '--mic-level': micLevel } as React.CSSProperties}
        >
          <button
            className={`control-btn ${isMuted ? 'active' : ''}`}
            onClick={handleToggleMute}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? '🔇' : '🎤'}
          </button>
        </div>
        <button
          className={`control-btn ${isVideoOff ? 'active' : ''}`}
          onClick={handleToggleVideo}
          title={isVideoOff ? 'Turn on camera' : 'Turn off camera'}
        >
          {isVideoOff ? '📷' : '🎥'}
        </button>
        <button
          className={`control-btn ${showChat ? 'chat-active' : ''}`}
          onClick={() => setShowChat((v) => !v)}
          title={showChat ? 'Hide chat' : 'Show chat'}
        >
          💬
        </button>
        <button className="control-btn end-call" onClick={handleLeaveGroupCall} title="Leave call">
          📞
        </button>
      </div>
    </div>
  );
}
