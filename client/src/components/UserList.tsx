import { useState, useEffect } from 'react';
import { Phone } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { apiService, apiErrorText } from '@/services/api';
import { callService } from '@/services/call';
import { Avatar } from '@/components/Avatar';
import { useMemberList } from '@/components/useMemberList';
import { can, PERMISSIONS } from '@/utils/permissions';
import { inviteExpiry } from '@/utils/inviteExpiry';
import type { MemberWithUser, Invite } from '@/types';
import { useT } from '@/i18n';
import './UserList.css';

interface UserListProps {
  voiceParticipants?: Map<string, string[]>;
}

export { chunkUserIds, lastSeenLabel } from './useMemberList';

export function UserList({ voiceParticipants }: UserListProps) {
  const t = useT();
  const { user: currentUser } = useAuthStore();
  const { onlineMembers, offlineMembers, voiceNameFor, lastSeenFor } = useMemberList(voiceParticipants);

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
      const createdFor = currentServer.id;
      try {
        const created = await apiService.createInvite(createdFor);
        // Пользователь мог переключить сервер, пока запрос был в полёте —
        // тогда инвайт чужой, и показывать (а тем более копировать) его нельзя.
        if (useServerStore.getState().currentServer?.id !== createdFor) return;
        inv = created;
        setInvite(created);
      } catch (err) {
        if (useServerStore.getState().currentServer?.id !== createdFor) return;
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

  const renderMember = (m: MemberWithUser, online: boolean) => {
    const voiceName = voiceNameFor(m, online);
    const lastSeen = lastSeenFor(m, online);
    return (
      <div key={m.user_id} className={`user-item${online ? '' : ' is-offline'}`}>
        <span className={`user-avatar-wrap${online ? ' is-online' : ''}`}>
          {/* `Avatar` REPLACES this prop, it does not append (Avatar.tsx:24,29),
              so this is the only source of the element's classes. */}
          <Avatar url={m.avatar_url} username={m.username} className="user-avatar-list" />
        </span>
        <div className="user-item-text">
          <span className="user-name">{m.username}</span>
          {voiceName && <span className="user-item-sub">{t('server.inVoice', { channel: voiceName })}</span>}
          {lastSeen && <span className="user-item-sub">{lastSeen}</span>}
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
