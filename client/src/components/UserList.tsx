import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, Phone } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { useLocaleStore, type Locale } from '@/stores/localeStore';
import { apiService, apiErrorText } from '@/services/api';
import { callService } from '@/services/call';
import { Avatar } from '@/components/Avatar';
import { useOnlineIds } from '@/hooks/useOnlineIds';
import { logger } from '@/utils/logger';
import { voiceChannelNameFor } from '@/utils/voiceMembership';
import { can, PERMISSIONS } from '@/utils/permissions';
import { inviteExpiry } from '@/utils/inviteExpiry';
import type { MemberWithUser, Invite } from '@/types';
import { useT, useTp, type TFunc, type TKey, type TVars } from '@/i18n';
import { formatLastSeen } from '@/i18n/format';
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

// LAST_SEEN_BATCH_CHUNK_SIZE mirrors the server-side cap on POST
// /api/v1/users/last-seen (usecase/user.go). Sending more than this in one
// request 400s the entire call — see chunkUserIds.
const LAST_SEEN_BATCH_CHUNK_SIZE = 200;

// Pure: splits ids into groups of at most `size`, preserving order. Used to
// stay under the server's per-request cap on POST /api/v1/users/last-seen —
// without it, any server with more offline members than the cap (or even a
// mid-size server on first render, before onlineIds has been populated and
// every member is transiently "offline") makes the batch call 400 and the
// whole last-seen feature goes dark.
export function chunkUserIds(ids: string[], size: number): string[][] {
  if (size <= 0) return ids.length === 0 ? [] : [ids];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

// Pure decision: null/undefined last_seen_at (never seen, or hidden by the
// user's own privacy setting — the API intentionally makes both look the
// same, see the last-seen spec) renders nothing; otherwise delegate to
// formatLastSeen.
export function lastSeenLabel(
  lastSeenAt: string | null | undefined,
  now: Date,
  locale: Locale,
  t: TFunc,
  tp: (key: TKey, count: number, vars?: TVars) => string,
): string | null {
  if (!lastSeenAt) return null;
  return formatLastSeen(new Date(lastSeenAt), now, locale, t, tp);
}

export function UserList({ onMobileBack, voiceParticipants }: UserListProps) {
  const t = useT();
  const { user: currentUser } = useAuthStore();
  const { members, channels } = useServerStore();
  // HTTP-снимок + подписка на online_users/user_joined/user_left/user_updated
  // живёт в useOnlineIds (общий с HomeView.tsx — см. хук для рационале).
  const onlineIds = useOnlineIds();
  const tp = useTp();
  const locale = useLocaleStore((s) => s.locale);
  const [lastSeenById, setLastSeenById] = useState<Map<string, string | null>>(new Map());

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

  const { onlineMembers, offlineMembers } = useMemo(() => {
    const online: MemberWithUser[] = [];
    const offline: MemberWithUser[] = [];
    for (const m of members) {
      (onlineIds.has(m.user_id) ? online : offline).push(m);
    }
    return { onlineMembers: sortByUsername(online), offlineMembers: sortByUsername(offline) };
  }, [members, onlineIds]);

  // Keyed on the actual SET of offline user ids (as a stable string), not on
  // offlineMembers' array identity — that array is rebuilt on every
  // online_users/user_joined/user_left/user_updated WS event even when the
  // offline membership itself hasn't changed, which would otherwise re-fire
  // this fetch on every unrelated presence event.
  const offlineUserIdsKey = useMemo(
    () => offlineMembers.map((m) => m.user_id).sort().join(','),
    [offlineMembers]
  );

  useEffect(() => {
    if (offlineMembers.length === 0) return;
    let cancelled = false;
    const chunks = chunkUserIds(
      offlineMembers.map((m) => m.user_id),
      LAST_SEEN_BATCH_CHUNK_SIZE
    );
    Promise.all(chunks.map((chunk) => apiService.getLastSeenBatch(chunk)))
      .then((results) => {
        if (cancelled) return;
        const merged = new Map<string, string | null>();
        for (const res of results) {
          for (const [id, info] of Object.entries(res)) {
            merged.set(id, info.last_seen_at);
          }
        }
        setLastSeenById(merged);
      })
      .catch((err) => logger.error('Failed to load last seen:', err, { module: 'userList' }));
    return () => {
      cancelled = true;
    };
    // Deliberately keyed on offlineUserIdsKey, not offlineMembers — see comment above.
  }, [offlineUserIdsKey]);

  const renderMember = (m: MemberWithUser, online: boolean) => {
    const voiceName = online ? voiceChannelNameFor(m.user_id, voiceParticipants, channels) : null;
    const lastSeen = online ? null : lastSeenLabel(lastSeenById.get(m.user_id), new Date(), locale, t, tp);
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
      <div className="user-list-mobile-header">
        {onMobileBack && (
          <button className="mobile-back-btn" onClick={onMobileBack} aria-label={t('common.back')}>
            <ChevronLeft size={18} strokeWidth={1.8} />
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
