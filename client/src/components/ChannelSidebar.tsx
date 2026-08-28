import { useState, useEffect, useMemo, type MouseEvent } from 'react';
import { ChevronDown, ChevronLeft, Hash, Plus, Mic, MicOff, Volume2, Headphones, Settings as SettingsIcon, LogOut } from 'lucide-react';
import type { Server, Channel, User, MemberWithUser } from '@/types';
import { Settings } from '@/components/Settings';
import { Avatar } from '@/components/Avatar';
import { ContextMenu } from '@/components/ContextMenu';
import { EditChannelModal } from '@/components/EditChannelModal';
import { CreateChannelModal } from '@/components/CreateChannelModal';
import { EditServerModal } from '@/components/EditServerModal';
import { ManageInvitesModal } from '@/components/ManageInvitesModal';
import { CallDock } from '@/components/CallDock';
import { apiService, apiErrorText } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { useCallStore } from '@/stores/callStore';
import { noiseCancellationService } from '@/services/noiseCancellation';
import { can, PERMISSIONS } from '@/utils/permissions';
import { useT } from '@/i18n';
import './ChannelSidebar.css';

interface ChannelSidebarProps {
  server: Server | null;
  channels: Channel[];
  currentChannel: Channel | null;
  onSelectChannel: (channel: Channel) => void;
  onJoinVoice: (channel: Channel) => void;
  user: User | null;
  onLogout: () => void;
  onMobileBack?: () => void;
  voiceParticipants?: Map<string, string[]>;
  members: MemberWithUser[];
  onChannelDeleted: (channelId: string) => void;
  onGoToCall: (serverId: string | null, channelId: string) => void;
  onServerDeleted: (serverId: string) => void;
}

export function ChannelSidebar({
  server,
  channels,
  currentChannel,
  onSelectChannel,
  onJoinVoice,
  user,
  onLogout,
  onMobileBack,
  voiceParticipants,
  members,
  onChannelDeleted,
  onGoToCall,
  onServerDeleted,
}: ChannelSidebarProps) {
  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ncEnabled, setNcEnabled] = useState(false);
  const [channelMenu, setChannelMenu] = useState<{ x: number; y: number; channel: Channel } | null>(null);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [serverMenu, setServerMenu] = useState<{ x: number; y: number } | null>(null);
  const [editingServer, setEditingServer] = useState(false);
  const [invitingServer, setInvitingServer] = useState(false);
  const callChannelId = useCallStore((s) => s.callChannelId);
  const isMuted = useCallStore((s) => s.isMuted);
  const remoteMicMuted = useCallStore((s) => s.remoteMicMuted);

  const permissions = useServerStore((s) => (server ? s.permissions.get(server.id) : undefined));
  const canManageChannels = can(permissions, PERMISSIONS.MANAGE_CHANNELS);
  const canManageServer = can(permissions, PERMISSIONS.MANAGE_SERVER) || server?.owner_id === user?.id;
  const canInvite = can(permissions, PERMISSIONS.CREATE_INVITE);
  const isOwner = server?.owner_id === user?.id;
  const hasServerMenu = canManageServer || canInvite || isOwner;

  const handleDeleteServer = async () => {
    if (!server) return;
    if (!window.confirm(t('server.deleteConfirm', { name: server.name }))) return;
    try {
      await apiService.deleteServer(server.id);
      useServerStore.getState().removeServer(server.id);
      onServerDeleted(server.id);
    } catch (err) {
      console.error('Failed to delete server:', err);
      alert(apiErrorText(err, t));
    }
  };

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

  // 'on' | 'off' | null; null = state unknown (channel we're not in) → no icon.
  const micStateFor = (channelId: string, userId: string): 'on' | 'off' | null => {
    if (callChannelId !== channelId) return null;
    if (userId === user?.id) return isMuted ? 'off' : 'on';
    return remoteMicMuted.get(userId) ? 'off' : 'on';
  };

  if (!server) {
    return (
      <nav className="channel-sidebar">
        <div className="channel-header">
          {onMobileBack && (
            <button className="mobile-back-btn" onClick={onMobileBack} aria-label={t('common.back')}>
              <ChevronLeft size={18} strokeWidth={1.8} />
            </button>
          )}
          <h2>{t('server.home')}</h2>
        </div>
        <div className="no-server-message">
          <p>{t('channel.noServerHint')}</p>
        </div>
        <CallDock onGoToCall={onGoToCall} />
      </nav>
    );
  }

  return (
    <nav className="channel-sidebar">
      <div className="channel-header">
        {onMobileBack && (
          <button className="mobile-back-btn" onClick={onMobileBack} aria-label={t('common.back')}>
            <ChevronLeft size={18} strokeWidth={1.8} />
          </button>
        )}
        <h2>{server.name}</h2>
        {hasServerMenu && (
          <button
            type="button"
            className="channel-header-menu"
            aria-label={t('server.serverMenu')}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setServerMenu({ x: r.left, y: r.bottom + 4 });
            }}
          >
            <ChevronDown size={18} strokeWidth={1.8} />
          </button>
        )}
      </div>

      <div className="channel-list">
        <div className="channel-category">
          <span>{t('channel.channels')}</span>
          {canManageChannels && (
            <button
              type="button"
              className="channel-category-add"
              title={t('channel.createChannelMenu')}
              onClick={() => setCreatingChannel(true)}
            >
              <Plus size={15} strokeWidth={1.8} />
            </button>
          )}
        </div>
        {channels.map((channel) => {
          const participantIds = voiceParticipants?.get(channel.id) ?? [];
          const isCallChannel = callChannelId === channel.id;
          const isActive = currentChannel?.id === channel.id;
          const openMenu = (e: MouseEvent) => {
            if (!canManageChannels) return;
            e.preventDefault();
            setChannelMenu({ x: e.clientX, y: e.clientY, channel });
          };

          if (participantIds.length > 0) {
            // Активная голосовая сессия — карточка (board 1c, адаптация VYC-77:
            // карточку получает ЛЮБОЙ канал с участниками, типа каналов нет).
            return (
              <div
                key={channel.id}
                className={`voice-card${isActive ? ' current' : ''}`}
                onContextMenu={openMenu}
              >
                <div className="voice-card-row" onClick={() => onSelectChannel(channel)}>
                  <Volume2 size={16} strokeWidth={1.8} className="voice-card-icon" />
                  <span className="voice-card-name">{channel.name}</span>
                  <span className="voice-card-count">{participantIds.length}</span>
                </div>
                <div className="voice-card-participants">
                  {participantIds.map((userId) => {
                    const mic = micStateFor(channel.id, userId);
                    return (
                      <div
                        key={userId}
                        className={`voice-participant${userId === user?.id ? ' is-self' : ''}`}
                        onClick={() => onSelectChannel(channel)}
                      >
                        <Avatar
                          url={resolveAvatarUrl(userId)}
                          username={resolveUsername(userId)}
                          className="voice-participant-avatar"
                        />
                        <span className="voice-participant-name">{resolveUsername(userId)}</span>
                        {mic === 'on' && <Mic size={14} strokeWidth={1.8} className="voice-participant-mic" />}
                        {mic === 'off' && <MicOff size={14} strokeWidth={1.8} className="voice-participant-mic off" />}
                      </div>
                    );
                  })}
                </div>
                {!isCallChannel && (
                  <button type="button" className="voice-card-join" onClick={() => onJoinVoice(channel)}>
                    {t('call.joinChannel')}
                  </button>
                )}
              </div>
            );
          }

          return (
            <div
              key={channel.id}
              className={`channel${isActive ? ' active' : ''}`}
              onClick={() => onSelectChannel(channel)}
              onContextMenu={openMenu}
            >
              <Hash size={16} strokeWidth={1.8} className="channel-hash" />
              <span className="channel-name">{channel.name}</span>
              <button
                type="button"
                className="channel-join-voice"
                title={t('call.joinVoice')}
                aria-label={t('call.joinVoice')}
                onClick={(e) => {
                  e.stopPropagation();
                  onJoinVoice(channel);
                }}
              >
                <Headphones size={14} strokeWidth={1.8} />
                <span className="channel-join-voice-label">{t('call.joinVoice')}</span>
              </button>
            </div>
          );
        })}
      </div>

      <CallDock onGoToCall={onGoToCall} />

      <div className="user-panel">
        <span className="user-avatar-wrap is-online">
          <Avatar url={user?.avatar_url} username={user?.username ?? ''} className="user-avatar small" />
        </span>
        <div className="user-details">
          <span className="user-tag">{user?.username}</span>
          <span className="user-status-text">
            {t('server.online')}
            {ncEnabled && ` · ${t('channel.ncOn')}`}
          </span>
        </div>
        <div className="user-actions">
          <button
            type="button"
            className="panel-icon-btn"
            onClick={() => setSettingsOpen(true)}
            title={t('settings.title')}
          >
            <SettingsIcon size={16} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="panel-icon-btn is-danger"
            onClick={() => setConfirmLogout(true)}
            title={t('common.logout')}
          >
            <LogOut size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      <Settings isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {confirmLogout && (
        <div className="modal-overlay" onClick={() => setConfirmLogout(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('common.logoutConfirm')}</h2>
            <div className="modal-actions">
              <button onClick={() => setConfirmLogout(false)}>{t('common.no')}</button>
              <button type="button" onClick={onLogout} className="primary">
                {t('common.yes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {channelMenu && (
        <ContextMenu
          x={channelMenu.x}
          y={channelMenu.y}
          onClose={() => setChannelMenu(null)}
          items={[
            ...(canManageChannels
              ? [{ label: t('channel.editMenu'), onClick: () => setEditingChannel(channelMenu.channel) }]
              : []),
            ...(canManageChannels
              ? [{
                  label: t('channel.deleteMenu'),
                  danger: true,
                  disabled: channels.length <= 1,
                  disabledReason: t('channel.deleteLastDisabled'),
                  onClick: () => handleDeleteChannel(channelMenu.channel),
                }]
              : []),
          ]}
        />
      )}

      {editingChannel && server && (
        <EditChannelModal
          serverId={server.id}
          channel={editingChannel}
          onClose={() => setEditingChannel(null)}
        />
      )}

      {creatingChannel && server && (
        <CreateChannelModal serverId={server.id} onClose={() => setCreatingChannel(false)} />
      )}

      {serverMenu && server && (
        <ContextMenu
          x={serverMenu.x}
          y={serverMenu.y}
          onClose={() => setServerMenu(null)}
          items={[
            ...(canInvite ? [{ label: t('server.inviteMenu'), onClick: () => setInvitingServer(true) }] : []),
            ...(canManageServer ? [{ label: t('server.editMenu'), onClick: () => setEditingServer(true) }] : []),
            ...(isOwner ? [{ label: t('server.deleteMenu'), danger: true, onClick: handleDeleteServer }] : []),
          ]}
        />
      )}
      {editingServer && server && <EditServerModal server={server} onClose={() => setEditingServer(false)} />}
      {invitingServer && server && <ManageInvitesModal serverId={server.id} onClose={() => setInvitingServer(false)} />}
    </nav>
  );
}
