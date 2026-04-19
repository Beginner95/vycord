import { useEffect, useState } from 'react';
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
import type { Server, Channel, Message } from '@/types';
import './AppPage.css';

export function AppPage() {
  const { user, token, logout } = useAuthStore();
  const { servers, setServers, setCurrentServer, currentServer, setChannels, channels, currentChannel, setCurrentChannel } = useServerStore();
  const { setMessages } = useMessageStore();
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [newServerName, setNewServerName] = useState('');

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
          const channelsData = await apiService.getChannels(server.id) as Channel[];
          setChannels(channelsData);

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
    try {
      const data = await apiService.getChannels(server.id) as Channel[];
      setChannels(data);
      // Select first text channel
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

    // Notify server which channel we're viewing for targeted message routing
    wsService.send('join_channel', { channel_id: channel.id });

    // Persist to DB (fire-and-forget)
    const currentSrv = useServerStore.getState().currentServer;
    apiService.updateLastVisited(currentSrv?.id ?? null, channel.id).catch(() => {});

    // If voice channel, join group call
    if (channel.type === 'voice' && user) {
      const joinGroupCall = (window as unknown as Record<string, unknown>).joinGroupCall;
      if (typeof joinGroupCall === 'function') {
        await joinGroupCall(channel.id);
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
      <div className="app-layout">
        <ServerList
          servers={servers}
          currentServer={currentServer}
          onSelectServer={handleSelectServer}
          onCreateServer={() => setShowCreateServer(true)}
          onJoinServer={handleJoinServer}
        />

        <ChannelSidebar
          server={currentServer}
          channels={channels}
          currentChannel={currentChannel}
          onSelectChannel={handleSelectChannel}
          user={user}
          onLogout={logout}
        />

        <ChatArea
          channel={currentChannel}
          user={user}
        />

        <UserList />
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

      <CallUI />
      <GroupCallUI />
    </div>
  );
}
