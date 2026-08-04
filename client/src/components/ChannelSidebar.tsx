import { useState, useEffect, useMemo } from 'react';
import type { Server, Channel, ChannelType, User, MemberWithUser } from '@/types';
import { Settings } from '@/components/Settings';
import { Avatar } from '@/components/Avatar';
import { ContextMenu } from '@/components/ContextMenu';
import { EditChannelModal } from '@/components/EditChannelModal';
import { CreateChannelModal } from '@/components/CreateChannelModal';
import { apiService, apiErrorText } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { noiseCancellationService } from '@/services/noiseCancellation';
import { can, PERMISSIONS } from '@/utils/permissions';
import { useT } from '@/i18n';
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
  onChannelDeleted: (channelId: string) => void;
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
  onChannelDeleted,
}: ChannelSidebarProps) {
  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ncEnabled, setNcEnabled] = useState(false);
  const [channelMenu, setChannelMenu] = useState<{ x: number; y: number; channel: Channel } | null>(null);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [creatingChannelType, setCreatingChannelType] = useState<ChannelType | null>(null);

  const permissions = useServerStore((s) => (server ? s.permissions.get(server.id) : undefined));
  const canManageChannels = can(permissions, PERMISSIONS.MANAGE_CHANNELS);

  const handleDeleteChannel = async (channel: Channel) => {
    if (!server) return;
    if (channels.length <= 1) return;
    if (!window.confirm(t('channel.deleteConfirm', { name: channel.name }))) return;
    try {
      await apiService.deleteChannel(server.id, channel.id);
      useServerStore.getState().removeChannel(channel.id);
      onChannelDeleted(channel.id);
    } catch (err) {
      console.error('Failed to delete channel:', err);
      alert(apiErrorText(err, t));
    }
  };

  const memberById = useMemo(() => {
    const map = new Map<string, MemberWithUser>();
    for (const m of members) map.set(m.user_id, m);
    return map;
  }, [members]);

  const resolveUsername = (userId: string): string => memberById.get(userId)?.username ?? userId.slice(0, 8);
  const resolveAvatarUrl = (userId: string): string | undefined => memberById.get(userId)?.avatar_url;

  useEffect(() => {
    // Подписка не выдаёт текущее состояние при регистрации — без явного чтения
    // default-on не виден до первого notify() (старта звонка).
    setNcEnabled(noiseCancellationService.getState().isEnabled);
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
            <button className="mobile-back-btn" onClick={onMobileBack} aria-label={t('common.back')}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          )}
          <h2>{t('server.home')}</h2>
        </div>
        <div className="no-server-message">
          <p>{t('channel.noServerHint')}</p>
        </div>
      </nav>
    );
  }

  return (
    <nav className="channel-sidebar">
      <div className="channel-header">
        {onMobileBack && (
          <button className="mobile-back-btn" onClick={onMobileBack} aria-label={t('common.back')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        )}
        <h2>{server.name}</h2>
      </div>

      <div className="channel-list">
        {(textChannels.length > 0 || canManageChannels) && (
          <>
            <div className="channel-category">
              <span>{t('channel.textChannels')}</span>
              {canManageChannels && (
                <button
                  type="button"
                  className="channel-category-add"
                  title={t('channel.createChannelMenu')}
                  onClick={() => setCreatingChannelType('text')}
                >
                  +
                </button>
              )}
            </div>
            {textChannels.map((channel) => (
              <div
                key={channel.id}
                className={`channel ${currentChannel?.id === channel.id ? 'active' : ''}`}
                onClick={() => onSelectChannel(channel)}
                onContextMenu={(e) => {
                  if (!canManageChannels) return;
                  e.preventDefault();
                  setChannelMenu({ x: e.clientX, y: e.clientY, channel });
                }}
              >
                {channel.is_private && <span className="channel-lock" title={t('channel.privateLabel')}>🔒</span>}
                {channel.name}
              </div>
            ))}
          </>
        )}

        {(voiceChannels.length > 0 || canManageChannels) && (
          <>
            <div className="channel-category">
              <span>{t('channel.voiceChannels')}</span>
              {canManageChannels && (
                <button
                  type="button"
                  className="channel-category-add"
                  title={t('channel.createChannelMenu')}
                  onClick={() => setCreatingChannelType('voice')}
                >
                  +
                </button>
              )}
            </div>
            {voiceChannels.map((channel) => {
              const participantIds = voiceParticipants?.get(channel.id) ?? [];
              return (
                <div key={channel.id} className="voice-channel-group">
                  <div
                    className={`channel voice ${currentChannel?.id === channel.id ? 'active' : ''}`}
                    onClick={() => onSelectChannel(channel)}
                    onContextMenu={(e) => {
                      if (!canManageChannels) return;
                      e.preventDefault();
                      setChannelMenu({ x: e.clientX, y: e.clientY, channel });
                    }}
                  >
                    {channel.is_private && <span className="channel-lock" title={t('channel.privateLabel')}>🔒</span>}
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
                          <Avatar
                            url={resolveAvatarUrl(userId)}
                            username={resolveUsername(userId)}
                            className="voice-participant-avatar"
                          />
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
          <Avatar url={user?.avatar_url} username={user?.username ?? ''} className="user-avatar small" />
          <div className="user-details">
            <span className="user-tag">{user?.username}</span>
            <span className="user-status-text">
              {t('server.online')}
              {ncEnabled && <span className="nc-badge">🔇 NC</span>}
            </span>
          </div>
        </div>
        <div className="user-actions">
          <button onClick={() => setSettingsOpen(true)} title={t('settings.title')} className="settings-btn">
            ⚙
          </button>
          <button onClick={onLogout} title={t('common.logout')} className="logout-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </div>

      <Settings isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {channelMenu && (
        <ContextMenu
          x={channelMenu.x}
          y={channelMenu.y}
          onClose={() => setChannelMenu(null)}
          items={[
            { label: t('channel.editMenu'), onClick: () => setEditingChannel(channelMenu.channel) },
            {
              label: t('channel.deleteMenu'),
              danger: true,
              disabled: channels.length <= 1,
              disabledReason: t('channel.deleteLastDisabled'),
              onClick: () => handleDeleteChannel(channelMenu.channel),
            },
          ]}
        />
      )}

      {editingChannel && server && (
        <EditChannelModal
          serverId={server.id}
          channel={editingChannel}
          userId={user?.id}
          permissions={permissions}
          onClose={() => setEditingChannel(null)}
        />
      )}

      {creatingChannelType && server && (
        <CreateChannelModal
          serverId={server.id}
          defaultType={creatingChannelType}
          onClose={() => setCreatingChannelType(null)}
        />
      )}
    </nav>
  );
}
