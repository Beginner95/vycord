import { useState, useEffect, useMemo } from 'react';
import { useServerStore } from '@/stores/serverStore';
import { useLocaleStore, type Locale } from '@/stores/localeStore';
import { apiService } from '@/services/api';
import { useOnlineIds } from '@/hooks/useOnlineIds';
import { logger } from '@/utils/logger';
import { voiceChannelNameFor } from '@/utils/voiceMembership';
import type { MemberWithUser } from '@/types';
import { useT, useTp, type TFunc, type TKey, type TVars } from '@/i18n';
import { formatLastSeen } from '@/i18n/format';

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

/** Разбиение участников на онлайн/офлайн + подписи «в голосовом» и «был(а) …».
 *  Общий для десктопного UserList и мобильного экрана channelInfo. */
export function useMemberList(voiceParticipants?: Map<string, string[]>) {
  const t = useT();
  const { members, channels } = useServerStore();
  // HTTP-снимок + подписка на online_users/user_joined/user_left/user_updated
  // живёт в useOnlineIds (общий с HomeView.tsx — см. хук для рационале).
  const onlineIds = useOnlineIds();
  const tp = useTp();
  const locale = useLocaleStore((s) => s.locale);
  const [lastSeenById, setLastSeenById] = useState<Map<string, string | null>>(new Map());

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

  const voiceNameFor = (m: MemberWithUser, online: boolean): string | null =>
    online ? voiceChannelNameFor(m.user_id, voiceParticipants, channels) : null;

  const lastSeenFor = (m: MemberWithUser, online: boolean): string | null =>
    online ? null : lastSeenLabel(lastSeenById.get(m.user_id), new Date(), locale, t, tp);

  return { onlineMembers, offlineMembers, voiceNameFor, lastSeenFor };
}
