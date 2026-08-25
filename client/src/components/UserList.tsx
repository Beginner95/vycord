import { useState, useEffect, useMemo } from 'react';
import { Phone } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { apiService, apiErrorText } from '@/services/api';
import { wsService } from '@/services/websocket';
import { callService } from '@/services/call';
import { Avatar } from '@/components/Avatar';
import { logger } from '@/utils/logger';
import { voiceChannelNameFor } from '@/utils/voiceMembership';
import { can, PERMISSIONS } from '@/utils/permissions';
import { inviteExpiry } from '@/utils/inviteExpiry';
import type { User, MemberWithUser, Invite } from '@/types';
import { useT } from '@/i18n';
import './UserList.css';

interface UserListProps {
  onMobileBack?: () => void;
  voiceParticipants?: Map<string, string[]>;
}

function sortByUsername(members: MemberWithUser[]): MemberWithUser[] {
  return [...members].sort((a, b) =>
    a.username.localeCompare(b.username, undefined, { sensitivity: 'base' })
  );
}

export function UserList({ onMobileBack, voiceParticipants }: UserListProps) {
  const t = useT();
  const { user: currentUser } = useAuthStore();
  const { members, channels } = useServerStore();
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadOnlineIds();

    // Any of these events means the set of globally-online users may have
    // changed, so re-fetch. (user_updated fires on avatar changes too, but
    // re-fetching on it is harmless — same trigger set the old code used.)
    const unsubscribers = [
      wsService.on('online_users', () => loadOnlineIds()),
      wsService.on('user_joined', () => loadOnlineIds()),
      wsService.on('user_left', () => loadOnlineIds()),
      wsService.on('user_updated', () => loadOnlineIds()),
    ];

    return () => unsubscribers.forEach((unsub) => unsub());
  }, []);

  const loadOnlineIds = async () => {
    try {
      const users = await apiService.getOnlineUsers() as User[];
      setOnlineIds(new Set(users.map((u) => u.id)));
    } catch (err) {
      logger.error('Failed to load online users:', err, { module: 'userList' });
    }
  };

  const handleCallUser = async (userId: string) => {
    await callService.startCall(userId);
  };

  const currentServer = useServerStore((s) => s.currentServer);
  const invitePerms = useServerStore((s) =>
    s.currentServer ? s.permissions.get(s.currentServer.id) : undefined
  );
  const canInvite =
    !!currentServer &&
    (can(invitePerms, PERMISSIONS.CREATE_INVITE) || currentServer.owner_id === currentUser?.id);

  const [invite, setInvite] = useState<Invite | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);

  // Смена сервера — карточка начинает с чистого листа.
  useEffect(() => {
    setInvite(null);
    setInviteError('');
    setInviteCopied(false);
  }, [currentServer?.id]);

  const handleCopyInvite = async () => {
    if (!currentServer) return;
    setInviteError('');
    let inv = invite;
    if (!inv) {
      setInviteBusy(true);
      try {
        inv = await apiService.createInvite(currentServer.id);
        setInvite(inv);
      } catch (err) {
        setInviteError(apiErrorText(err, t));
        return;
      } finally {
        setInviteBusy(false);
      }
    }
    navigator.clipboard?.writeText(inv.code).catch(() => {});
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  const { onlineMembers, offlineMembers } = useMemo(() => {
    const online: MemberWithUser[] = [];
    const offline: MemberWithUser[] = [];
    for (const m of members) {
      (onlineIds.has(m.user_id) ? online : offline).push(m);
    }
    return { onlineMembers: sortByUsername(online), offlineMembers: sortByUsername(offline) };
  }, [members, onlineIds]);

  const renderMember = (m: MemberWithUser, online: boolean) => {
    const voiceName = online ? voiceChannelNameFor(m.user_id, voiceParticipants, channels) : null;
    return (
      <div key={m.user_id} className={`user-item${online ? '' : ' offline'}`}>
        <span className={`user-avatar-wrap${online ? ' online' : ''}`}>
          <Avatar url={m.avatar_url} username={m.username} className="user-avatar list" />
        </span>
        <div className="user-item-text">
          <span className="username">{m.username}</span>
          {voiceName && <span className="user-item-sub">{t('server.inVoice', { channel: voiceName })}</span>}
        </div>
        {online && currentUser && m.user_id !== currentUser.id && (
          <button
            className="call-user-btn"
            onClick={() => handleCallUser(m.user_id)}
            title={t('server.callUser', { name: m.username })}
          >
            <Phone size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>
    );
  };

  return (
    <aside className="user-list">
      <div className="user-list-mobile-header">
        {onMobileBack && (
          <button className="mobile-back-btn" onClick={onMobileBack} aria-label={t('common.back')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        )}
        <span>{t('chat.members')}</span>
      </div>
      <div className="user-list-scroll">
        <div className="user-category online-label">
          {t('server.online')} — {onlineMembers.length}
        </div>
        {onlineMembers.map((m) => renderMember(m, true))}
        <div className="user-category">
          {t('server.offline')} — {offlineMembers.length}
        </div>
        {offlineMembers.map((m) => renderMember(m, false))}
      </div>
      {canInvite && currentServer && (
        <div className="invite-card">
          <span className="invite-card-title">{t('server.inviteCard.title')}</span>
          <p className="invite-card-sub">
            {(() => {
              if (!invite) return t('server.inviteCard.hint');
              const exp = inviteExpiry(invite.expires_at);
              return exp.kind === 'never'
                ? t('server.inviteCard.noExpiry')
                : t('server.inviteCard.expiresDays', { days: String(exp.days) });
            })()}
          </p>
          {inviteError && <p className="invite-card-error">{inviteError}</p>}
          <button
            type="button"
            className="btn btn-secondary invite-card-btn"
            onClick={handleCopyInvite}
            disabled={inviteBusy}
          >
            {inviteCopied ? t('server.invites.copied') : t('server.inviteCard.copyLink')}
          </button>
        </div>
      )}
    </aside>
  );
}
