import { useState, useEffect, useMemo } from 'react';
import type { Server, Channel, User, MemberWithUser } from '@/types';
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
  onMobileBack?: () => void;
  voiceParticipants?: Map<string, string[]>;
  members: MemberWithUser[];
}

export function ChannelSidebar({
  server,
  channels,
  currentChannel,
  onSelectChannel,
  user,
  onLogout,
  onMobileBack,
  voiceParticipants,
  members,
}: ChannelSidebarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ncEnabled, setNcEnabled] = useState(false);

  const usernameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.user_id, m.username);
    return map;
  }, [members]);

  const resolveUsername = (userId: string): string => usernameById.get(userId) ?? userId.slice(0, 8);

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
          {onMobileBack && (
            <button className="mobile-back-btn" onClick={onMobileBack} aria-label="Back">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          )}
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
        {onMobileBack && (
          <button className="mobile-back-btn" onClick={onMobileBack} aria-label="Back">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        )}
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
            {voiceChannels.map((channel) => {
              const participantIds = voiceParticipants?.get(channel.id) ?? [];
              return (
                <div key={channel.id} className="voice-channel-group">
                  <div
                    className={`channel voice ${currentChannel?.id === channel.id ? 'active' : ''}`}
                    onClick={() => onSelectChannel(channel)}
                  >
                    {channel.name}
                    {participantIds.length > 0 && (
                      <span className="voice-count">({participantIds.length})</span>
                    )}
                  </div>
                  {participantIds.length > 0 && (
                    <div className="voice-participant-list">
                      {participantIds.map((userId) => (
                        <div
                          key={userId}
                          className={`voice-participant ${userId === user?.id ? 'is-self' : ''}`}
                          onClick={() => onSelectChannel(channel)}
                        >
                          <div className="voice-participant-avatar">
                            {resolveUsername(userId).charAt(0).toUpperCase()}
                          </div>
                          <span className="voice-participant-name">{resolveUsername(userId)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
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
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </div>

      <Settings isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </nav>
  );
}
