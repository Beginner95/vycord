import { useState, useMemo, useRef, type MouseEvent } from 'react';
import { ChevronDown, ChevronLeft, Hash, Plus, Mic, MicOff, Volume2, Headphones, Pencil, Trash2 } from 'lucide-react';
import type { Server, Channel, User, MemberWithUser } from '@/types';
import { ConfirmModal } from '@/components/ConfirmModal';
import { Avatar } from '@/components/Avatar';
import { ContextMenu } from '@/components/ContextMenu';
import { EditChannelModal } from '@/components/EditChannelModal';
import { ServerMenu } from '@/components/ServerMenu';
import { apiService, apiErrorText } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { useCallStore } from '@/stores/callStore';
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
  onMobileBack?: () => void;
  voiceParticipants?: Map<string, string[]>;
  members: MemberWithUser[];
  onChannelDeleted: (channelId: string) => void;
  onServerDeleted: (serverId: string) => void;
  onCreateChannel: () => void;
}

export function ChannelSidebar({
  server,
  channels,
  currentChannel,
  onSelectChannel,
  onJoinVoice,
  user,
  onMobileBack,
  voiceParticipants,
  members,
  onChannelDeleted,
  onServerDeleted,
  onCreateChannel,
}: ChannelSidebarProps) {
  const t = useT();
  const [channelMenu, setChannelMenu] = useState<{ x: number; y: number; channel: Channel } | null>(null);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  // seq делает каждое открытие меню новым React-ключом: ServerMenu живёт до
  // dismiss тоста ошибки, и без нового ключа повторный клик по кнопке попадал
  // бы в уже смонтированный экземпляр с menuDismissed === true — меню не
  // открывалось бы до 5 секунд.
  const [serverMenu, setServerMenu] = useState<{ x: number; y: number; seq: number } | null>(null);
  const serverMenuSeq = useRef(0);
  const deletingChannelRef = useRef(false);
  const [confirmDeleteChannel, setConfirmDeleteChannel] = useState<Channel | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);
  const callChannelId = useCallStore((s) => s.callChannelId);
  const isMuted = useCallStore((s) => s.isMuted);
  const remoteMicMuted = useCallStore((s) => s.remoteMicMuted);

  const permissions = useServerStore((s) => (server ? s.permissions.get(server.id) : undefined));
  const canManageChannels = can(permissions, PERMISSIONS.MANAGE_CHANNELS);
  const canManageServer = can(permissions, PERMISSIONS.MANAGE_SERVER) || server?.owner_id === user?.id;
  const canInvite = can(permissions, PERMISSIONS.CREATE_INVITE);
  const isOwner = server?.owner_id === user?.id;
  const hasServerMenu = canManageServer || canInvite || isOwner;

  // Подтверждение удаления канала — ConfirmModal, ошибка — .error-toast
  // (решение 15/16): нативные confirm/alert с этой поверхности убраны.
  const handleDeleteChannel = async (channel: Channel) => {
    if (!server) {
      setConfirmDeleteChannel(null);
      return;
    }
    // Гейт последнего канала: список мог измениться (WS от другого клиента),
    // пока модалка открыта. Раньше здесь был голый return — модалка оставалась
    // на экране с неработающей кнопкой «Удалить».
    if (channels.length <= 1) {
      setConfirmDeleteChannel(null);
      setChannelError(t('channel.deleteLastDisabled'));
      setTimeout(() => setChannelError(null), 5000);
      return;
    }
    if (deletingChannelRef.current) return;
    deletingChannelRef.current = true;
    try {
      await apiService.deleteChannel(server.id, channel.id);
      useServerStore.getState().removeChannel(channel.id);
      onChannelDeleted(channel.id);
      setConfirmDeleteChannel(null);
    } catch (err) {
      setConfirmDeleteChannel(null);
      setChannelError(apiErrorText(err, t));
      setTimeout(() => setChannelError(null), 5000);
    } finally {
      deletingChannelRef.current = false;
    }
  };

  const memberById = useMemo(() => {
    const map = new Map<string, MemberWithUser>();
    for (const m of members) map.set(m.user_id, m);
    return map;
  }, [members]);

  const resolveUsername = (userId: string): string => memberById.get(userId)?.username ?? userId.slice(0, 8);
  const resolveAvatarUrl = (userId: string): string | undefined => memberById.get(userId)?.avatar_url;

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
              setServerMenu({ x: r.left, y: r.bottom + 4, seq: ++serverMenuSeq.current });
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
              onClick={() => onCreateChannel()}
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
                className={`voice-card${isActive ? ' is-current' : ''}`}
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
                        {mic === 'off' && <MicOff size={14} strokeWidth={1.8} className="voice-participant-mic is-off" />}
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
              className={`channel-row${isActive ? ' is-active' : ''}`}
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

      {channelMenu && (
        <ContextMenu
          x={channelMenu.x}
          y={channelMenu.y}
          label={channelMenu.channel.name}
          onClose={() => setChannelMenu(null)}
          items={[
            ...(canManageChannels
              ? [{
                  label: t('channel.editMenu'),
                  icon: <Pencil size={16} strokeWidth={1.8} />,
                  onClick: () => setEditingChannel(channelMenu.channel),
                }]
              : []),
            ...(canManageChannels
              ? [{
                  label: t('channel.deleteMenu'),
                  icon: <Trash2 size={16} strokeWidth={1.8} />,
                  danger: true,
                  disabled: channels.length <= 1,
                  disabledReason: t('channel.deleteLastDisabled'),
                  onClick: () => setConfirmDeleteChannel(channelMenu.channel),
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

      <ConfirmModal
        open={confirmDeleteChannel !== null}
        title={t('channel.deleteTitle', { name: confirmDeleteChannel?.name ?? '' })}
        body={t('channel.deleteBody')}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (confirmDeleteChannel) void handleDeleteChannel(confirmDeleteChannel);
        }}
        onCancel={() => setConfirmDeleteChannel(null)}
      />

      {channelError && <div className="error-toast">{channelError}</div>}

      {serverMenu && server && (
        <ServerMenu
          key={serverMenu.seq}
          server={server}
          user={user}
          anchor={serverMenu}
          onClose={() => setServerMenu(null)}
          onDeleted={onServerDeleted}
        />
      )}
    </nav>
  );
}
