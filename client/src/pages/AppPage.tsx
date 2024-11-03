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
  }, [currentChannel]);

  const loadServers = async () => {
    try {
      const data = await apiService.getServers() as Server[];
      setServers(data);
      if (data.length === 0) return;

      // Try to restore last visited server/channel
      const lastServer = useServerStore.getState().getLastServer();
      const lastChannel = useServerStore.getState().getLastChannel();

      if (lastServer) {
        const server = data.find((s) => s.id === lastServer.serverId);
        if (server) {
          setCurrentServer(server);
          const channelsData = await apiService.getChannels(server.id) as Channel[];
          setChannels(channelsData);

          // Try to restore last channel
          if (lastChannel) {
            const channel = channelsData.find((c) => c.id === lastChannel.channelId);
            if (channel) {
              setCurrentChannel(channel);
              const messages = await apiService.getMessages(channel.id);
              setMessages(messages as Message[]);
              return;
            }
          }

          // Fallback: select first text channel
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
          onJoinServer={handleSelectServer}
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
