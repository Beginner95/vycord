import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { useMessageStore } from '@/stores/messageStore';
import { wsService } from '@/services/websocket';
import { apiService } from '@/services/api';
import { ServerList } from '@/components/ServerList';
import { ChannelSidebar } from '@/components/ChannelSidebar';
import { ChatArea } from '@/components/ChatArea';
import { UserList } from '@/components/UserList';
import { TitleBar } from '@/components/TitleBar';
import { CallUI } from '@/components/CallUI';
import { GroupCallUI } from '@/components/GroupCallUI';
import { groupCallService } from '@/services/groupCall';
import type { Server, Channel, Message, MemberWithUser } from '@/types';
import './AppPage.css';

type MobilePanel = 'servers' | 'channels' | 'chat' | 'members';

interface CallNotif {
  channelId: string;
  channelName: string;
  callerId: string;
  callerName: string;
}

// Создаём контекст сразу — он будет suspended, но Chrome разрешит resume
// после первого жеста пользователя (логин, клик по каналу и т.д.)
const _audioCtx = new AudioContext();

const _resumeAudio = () => { _audioCtx.resume().catch(() => {}); };
document.addEventListener('click',    _resumeAudio, { capture: true, passive: true });
document.addEventListener('keydown',  _resumeAudio, { capture: true, passive: true });
document.addEventListener('touchend', _resumeAudio, { capture: true, passive: true });

async function playRingOnce(): Promise<void> {
  try {
    if (_audioCtx.state !== 'running') {
      await _audioCtx.resume();
    }
    const state: string = _audioCtx.state;
    if (state !== 'running') return; // жест ещё не был — пропускаем
    const gain = _audioCtx.createGain();
    gain.connect(_audioCtx.destination);
    const t = _audioCtx.currentTime;

    const playTone = (freq: number, offset: number) => {
      const osc = _audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.gain.setValueAtTime(0, t + offset);
      gain.gain.linearRampToValueAtTime(0.25, t + offset + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.35);
      osc.start(t + offset);
      osc.stop(t + offset + 0.36);
    };

    playTone(880,  0);
    playTone(1174, 0.18);
  } catch {
    // ignore
  }
}

function startCallRingtone(): () => void {
  void playRingOnce();
  const interval = window.setInterval(() => { void playRingOnce(); }, 2000);
  return () => window.clearInterval(interval);
}

export function AppPage() {
  const { user, token, logout } = useAuthStore();
  const { servers, setServers, setCurrentServer, currentServer, setChannels, channels, currentChannel, setCurrentChannel, setMembers, members } = useServerStore();
  const { setMessages } = useMessageStore();
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [newServerName, setNewServerName] = useState('');
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('servers');
  const [callNotif, setCallNotif] = useState<CallNotif | null>(null);
  const [voiceParticipants, setVoiceParticipants] = useState<Map<string, string[]>>(new Map());
  const stopRingtoneRef = useRef<(() => void) | null>(null);
  const callNotifRef = useRef<CallNotif | null>(null);
  const handledRemovalsRef = useRef<Set<string>>(new Set());
  useEffect(() => { callNotifRef.current = callNotif; }, [callNotif]);

  useEffect(() => {
    return () => { stopRingtoneRef.current?.(); };
  }, []);

  // Reconnect WebSocket on mount if already authenticated (page reload)
  useEffect(() => {
    if (token && !wsService.connected) {
      wsService.connect(token).catch((err) => {
        console.error('Failed to reconnect WebSocket:', err);
      });
    }
  }, [token]);

  useEffect(() => {
    // Load servers
    loadServers();
  }, []);

  useEffect(() => {
    // Listen for incoming messages via WebSocket
    const unsubscribe = wsService.on('chat_message', (payload) => {
      const msg = payload as Record<string, unknown>;
      if (currentChannel && msg.channel_id === currentChannel.id) {
        // Own messages are added optimistically via HTTP response in ChatArea — skip to avoid duplicates
        if (user && msg.user_id === user.id) return;
        const fullMsg: Message = {
          id: msg.id as string,
          channel_id: msg.channel_id as string,
          user_id: msg.user_id as string,
          content: msg.content as string,
          created_at: msg.created_at as string,
          updated_at: (msg.updated_at as string) || (msg.created_at as string),
        };
        useMessageStore.getState().addMessage(fullMsg);
      }
    });

    return () => unsubscribe();
  }, [currentChannel, user]);

  useEffect(() => {
    const unsubscribe = wsService.on('voice_call_ring', (payload) => {
      const p = payload as Record<string, unknown>;
      const alreadyInThatCall =
        groupCallService.isInGroupCallState &&
        groupCallService.currentRoomIdState === p.channel_id;
      if (
        p.server_id === currentServer?.id &&
        p.caller_id !== user?.id &&
        !alreadyInThatCall
      ) {
        stopRingtoneRef.current?.();
        setCallNotif({
          channelId: p.channel_id as string,
          channelName: p.channel_name as string,
          callerId: p.caller_id as string,
          callerName: p.caller_name as string,
        });
        stopRingtoneRef.current = startCallRingtone();
      }
    });
    return () => unsubscribe();
  }, [currentServer, user]);

  useEffect(() => {
    const unsubscribe = wsService.on('voice_call_cancel', (payload) => {
      const p = payload as Record<string, unknown>;
      if (callNotifRef.current?.channelId === p.channel_id) {
        stopRingtoneRef.current?.();
        stopRingtoneRef.current = null;
        setCallNotif(null);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubState = wsService.on('voice_state', (payload) => {
      const p = payload as { channels: Record<string, string[]> };
      setVoiceParticipants(new Map(Object.entries(p.channels ?? {})));
    });
    const unsubParticipants = wsService.on('voice_participants', (payload) => {
      const p = payload as { channel_id: string; user_ids: string[] };
      setVoiceParticipants((prev) => {
        const next = new Map(prev);
        if (p.user_ids.length === 0) {
          next.delete(p.channel_id);
        } else {
          next.set(p.channel_id, p.user_ids);
        }
        return next;
      });
    });
    return () => { unsubState(); unsubParticipants(); };
  }, []);

  useEffect(() => {
    const unsubscribe = wsService.on('user_updated', (payload) => {
      const p = payload as { id: string; avatar_url: string | null };
      if (p.id === useAuthStore.getState().user?.id) {
        useAuthStore.getState().updateUser({ avatar_url: p.avatar_url ?? undefined });
      }
      useServerStore.getState().patchMemberAvatar(p.id, p.avatar_url);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubServerUpdate = wsService.on('server_update', (payload) => {
      const p = payload as Server;
      useServerStore.getState().patchServer(p.id, { name: p.name, icon_url: p.icon_url });
    });
    const unsubChannelUpdate = wsService.on('channel_update', (payload) => {
      const p = payload as Channel;
      useServerStore.getState().patchChannel(p.id, { name: p.name });
    });
    const unsubServerDelete = wsService.on('server_delete', (payload) => {
      const { id } = payload as { id: string };
      useServerStore.getState().removeServer(id);
      handleServerRemoved(id);
    });
    const unsubChannelDelete = wsService.on('channel_delete', (payload) => {
      const { id } = payload as { id: string; server_id: string };
      useServerStore.getState().removeChannel(id);
      handleChannelRemoved(id);
    });
    return () => {
      unsubServerUpdate();
      unsubChannelUpdate();
      unsubServerDelete();
      unsubChannelDelete();
    };
  }, [currentServer, currentChannel, channels]);

  const loadServerMembers = (serverId: string) => {
    apiService.getServerMembers(serverId)
      .then((members) => setMembers(members as MemberWithUser[]))
      .catch((err) => console.error('Failed to load server members:', err));
  };

  const callLeaveGroupCall = () => {
    const w = window as unknown as Record<string, unknown>;
    (w.leaveGroupCall as (() => void) | undefined)?.();
  };

  const handleServerRemoved = (removedServerId: string) => {
    if (handledRemovalsRef.current.has(removedServerId)) return;
    handledRemovalsRef.current.add(removedServerId);

    if (currentServer?.id !== removedServerId) return;

    if (
      groupCallService.isInGroupCallState &&
      channels.some((c) => c.id === groupCallService.currentRoomIdState)
    ) {
      callLeaveGroupCall();
    }

    const remaining = useServerStore.getState().servers;
    if (remaining.length > 0) {
      handleSelectServer(remaining[0]);
    } else {
      setCurrentServer(null);
      setChannels([]);
      setCurrentChannel(null);
      setMembers([]);
      setMessages([]);
    }
  };

  const handleChannelRemoved = (removedChannelId: string) => {
    if (handledRemovalsRef.current.has(removedChannelId)) return;
    handledRemovalsRef.current.add(removedChannelId);

    if (groupCallService.isInGroupCallState && groupCallService.currentRoomIdState === removedChannelId) {
      callLeaveGroupCall();
    }

    if (currentChannel?.id !== removedChannelId) return;

    const remaining = useServerStore.getState().channels;
    const textChannel = remaining.find((c) => c.type === 'text');
    if (textChannel) {
      handleSelectChannel(textChannel);
    } else {
      setCurrentChannel(null);
      setMessages([]);
    }
  };

  const loadServers = async () => {
    try {
      type UserWithLastVisited = { last_server_id?: string; last_channel_id?: string };
      const [data, me] = await Promise.all([
        apiService.getServers() as Promise<Server[]>,
        apiService.getMe() as Promise<UserWithLastVisited>,
      ]);

      setServers(data);
      if (data.length === 0) return;

      const lastServerId = me?.last_server_id;
      const lastChannelId = me?.last_channel_id;

      if (lastServerId) {
        const server = data.find((s) => s.id === lastServerId);
        if (server) {
          setCurrentServer(server);
          setMembers([]);
          const channelsData = await apiService.getChannels(server.id) as Channel[];
          setChannels(channelsData);
          loadServerMembers(server.id);

          if (lastChannelId) {
            const channel = channelsData.find((c) => c.id === lastChannelId);
            if (channel) {
              setCurrentChannel(channel);
              wsService.send('join_channel', { channel_id: channel.id });
              const messages = await apiService.getMessages(channel.id);
              setMessages(messages as Message[]);
              return;
            }
          }

          const textChannel = channelsData.find((c) => c.type === 'text');
          if (textChannel) {
            handleSelectChannel(textChannel);
          }
          return;
        }
      }

      // No restore data — select first server
      handleSelectServer(data[0]);
    } catch (err) {
      console.error('Failed to load servers:', err);
    }
  };

  const handleJoinServer = async (server: Server) => {
    try {
      await apiService.joinServer(server.id);
    } catch (err: unknown) {
      // Ignore "already a member" or "owner" errors — proceed to select the server
      const msg = err instanceof Error ? err.message : '';
      if (!msg.includes('already') && !msg.includes('owner')) {
        console.error('Failed to join server:', err);
        return;
      }
    }
    // Add to sidebar if not already there
    const current = useServerStore.getState().servers;
    if (!current.find((s) => s.id === server.id)) {
      setServers([...current, server]);
    }
    handleSelectServer(server);
  };

  const handleSelectServer = async (server: Server) => {
    setCurrentServer(server);
    setMembers([]);
    setMobilePanel('channels');
    try {
      const data = await apiService.getChannels(server.id) as Channel[];
      setChannels(data);
      loadServerMembers(server.id);
      const textChannel = data.find((c) => c.type === 'text');
      if (textChannel) {
        handleSelectChannel(textChannel);
      }
    } catch (err) {
      console.error('Failed to load channels:', err);
    }
  };

  const handleSelectChannel = async (channel: Channel) => {
    setCurrentChannel(channel);
    setMobilePanel('chat');

    // Notify server which channel we're viewing for targeted message routing
    wsService.send('join_channel', { channel_id: channel.id });

    // Persist to DB (fire-and-forget)
    const currentSrv = useServerStore.getState().currentServer;
    apiService.updateLastVisited(currentSrv?.id ?? null, channel.id).catch(() => {});

    // If voice channel, join the group call; ring only if no one else is in the room yet.
    if (channel.type === 'voice' && user) {
      const joinGroupCall = (window as unknown as Record<string, unknown>).joinGroupCall as
        ((id: string) => Promise<boolean>) | undefined;
      if (typeof joinGroupCall === 'function') {
        const isFirst = await joinGroupCall(channel.id);
        if (isFirst) {
          wsService.send('voice_call_ring', {
            channel_id: channel.id,
            server_id: currentSrv?.id,
            caller_id: user.id,
            caller_name: user.username,
            channel_name: channel.name,
          });
        }
      }
    }

    try {
      const data = await apiService.getMessages(channel.id);
      setMessages(data as Message[]);
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  };

  const handleCreateServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServerName.trim()) return;

    try {
      const server = await apiService.createServer(newServerName.trim()) as Server;
      setServers([...servers, server]);
      setNewServerName('');
      setShowCreateServer(false);
      handleSelectServer(server);
    } catch (err) {
      console.error('Failed to create server:', err);
    }
  };

  return (
    <div className="app-page">
      <TitleBar />
      <div className="app-layout" data-mobile-panel={mobilePanel}>
        <ServerList
          servers={servers}
          currentServer={currentServer}
          user={user}
          onSelectServer={handleSelectServer}
          onCreateServer={() => setShowCreateServer(true)}
          onJoinServer={handleJoinServer}
          onServerDeleted={handleServerRemoved}
        />

        <ChannelSidebar
          server={currentServer}
          channels={channels}
          currentChannel={currentChannel}
          onSelectChannel={handleSelectChannel}
          user={user}
          onLogout={logout}
          onMobileBack={() => setMobilePanel('servers')}
          voiceParticipants={voiceParticipants}
          members={members}
          onChannelDeleted={handleChannelRemoved}
        />

        <ChatArea
          channel={currentChannel}
          user={user}
          onMobileBack={() => setMobilePanel('channels')}
          onShowMembers={() => setMobilePanel('members')}
        />

        <UserList onMobileBack={() => setMobilePanel('chat')} />
      </div>

      {showCreateServer && (
        <div className="modal-overlay" onClick={() => setShowCreateServer(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Create a Server</h2>
            <form onSubmit={handleCreateServer}>
              <div className="form-group">
                <label htmlFor="server-name">Server Name</label>
                <input
                  id="server-name"
                  type="text"
                  value={newServerName}
                  onChange={(e) => setNewServerName(e.target.value)}
                  placeholder="My Awesome Server"
                  maxLength={100}
                  autoFocus
                  required
                />
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowCreateServer(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {callNotif && (
        <div className="call-notif-banner">
          <span className="call-notif-icon">🔔</span>
          <span className="call-notif-text">
            <strong>{callNotif.callerName}</strong> зовёт в <strong>#{callNotif.channelName}</strong>
          </span>
          <button
            className="call-notif-join"
            onClick={() => {
              stopRingtoneRef.current?.();
              stopRingtoneRef.current = null;
              const ch = channels.find((c) => c.id === callNotif.channelId);
              if (ch) handleSelectChannel(ch);
              setCallNotif(null);
            }}
          >
            Войти
          </button>
          <button
            className="call-notif-dismiss"
            onClick={() => {
              stopRingtoneRef.current?.();
              stopRingtoneRef.current = null;
              setCallNotif(null);
            }}
          >
            ✕
          </button>
        </div>
      )}
      <CallUI />
      <GroupCallUI />
    </div>
  );
}
