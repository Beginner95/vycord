import { useState, useEffect } from 'react';
import type { Server, Channel, User } from '@/types';
import { Settings } from '@/components/Settings';
import { noiseCancellationService } from '@/services/noiseCancellation';
import './ChannelSidebar.css';

interface ChannelSidebarProps {
  server: Server | null;
  channels: Channel[];
  currentChannel: Channel | null;
  onSelectChannel: (channel: Channel) => void;
  user: User | null;
  onLogout: () => void;
}

export function ChannelSidebar({
  server,
  channels,
  currentChannel,
  onSelectChannel,
  user,
  onLogout,
}: ChannelSidebarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ncEnabled, setNcEnabled] = useState(false);

  useEffect(() => {
    const unsub = noiseCancellationService.onStateChange((state) => {
      setNcEnabled(state.isEnabled);
    });
    return unsub;
  }, []);

  const textChannels = channels.filter((c) => c.type === 'text');
  const voiceChannels = channels.filter((c) => c.type === 'voice');

  if (!server) {
    return (
      <nav className="channel-sidebar">
        <div className="channel-header">
          <h2>Home</h2>
        </div>
        <div className="no-server-message">
          <p>Select or create a server to get started</p>
        </div>
      </nav>
    );
  }

  return (
    <nav className="channel-sidebar">
      <div className="channel-header">
        <h2>{server.name}</h2>
      </div>

      <div className="channel-list">
        {textChannels.length > 0 && (
          <>
            <div className="channel-category">
              <span>Text Channels</span>
            </div>
            {textChannels.map((channel) => (
              <div
                key={channel.id}
                className={`channel ${currentChannel?.id === channel.id ? 'active' : ''}`}
                onClick={() => onSelectChannel(channel)}
              >
                {channel.name}
              </div>
            ))}
          </>
        )}

        {voiceChannels.length > 0 && (
          <>
            <div className="channel-category">
              <span>Voice Channels</span>
            </div>
            {voiceChannels.map((channel) => (
              <div
                key={channel.id}
                className={`channel voice ${currentChannel?.id === channel.id ? 'active' : ''}`}
                onClick={() => onSelectChannel(channel)}
              >
                {channel.name}
              </div>
            ))}
          </>
        )}
      </div>

      <div className="user-panel">
        <div className="user-info">
          <div className="user-avatar small">
            {user?.username?.charAt(0).toUpperCase()}
          </div>
          <div className="user-details">
            <span className="user-tag">{user?.username}</span>
            <span className="user-status-text">
              Online
              {ncEnabled && <span className="nc-badge">🔇 NC</span>}
            </span>
          </div>
        </div>
        <div className="user-actions">
          <button onClick={() => setSettingsOpen(true)} title="Settings" className="settings-btn">
            ⚙
          </button>
          <button onClick={onLogout} title="Logout" className="logout-btn">
            ⏻
          </button>
        </div>
      </div>

      <Settings isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </nav>
  );
}
