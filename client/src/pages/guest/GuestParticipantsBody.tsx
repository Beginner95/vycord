import { MicOff, Mic } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { useGuestCallStore } from '@/stores/guestCallStore';
import { useCallStore } from '@/stores/callStore';
import { useT } from '@/i18n';

/** Тело ростера участников — та же логика, что была встроена в
 *  `GuestCallView`. Используется десктопным aside (неизменно) и мобильным
 *  `GuestParticipantsScreen` (этап 6). */
export function GuestParticipantsBody() {
  const t = useT();
  const participants = useGuestCallStore((s) => s.participants);
  const guestId = useGuestCallStore((s) => s.guestId);
  const selfMuted = useCallStore((s) => s.isMuted);
  const remoteMicMuted = useCallStore((s) => s.remoteMicMuted);
  const selfIdentity = guestId ? `guest:${guestId}` : '';

  const rows = [
    ...participants.users.map((u) => ({
      id: u.user_id,
      name: u.username ?? u.user_id.slice(0, 8),
      avatarUrl: u.avatar_url,
      isGuest: false,
    })),
    ...participants.guests.map((g) => ({ id: g.id, name: g.display_name, avatarUrl: undefined, isGuest: true })),
  ];

  return (
    <ul className="guest-roster">
      {rows.map((row) => {
        const isSelf = row.id === selfIdentity;
        const muted = isSelf ? selfMuted : (remoteMicMuted.get(row.id) ?? false);
        return (
          <li key={row.id} className="guest-roster-row">
            <Avatar username={row.name} url={row.avatarUrl} className="guest-roster-avatar" />
            <span className="guest-roster-name">{row.name}</span>
            {row.isGuest && <span className="guest-roster-chip">{t('guest.guestBadge')}</span>}
            {isSelf && <span className="guest-roster-chip is-self">{t('guest.youBadge')}</span>}
            <span className={`guest-roster-mic${muted ? ' is-muted' : ''}`}>
              {muted ? <MicOff size={14} strokeWidth={1.8} /> : <Mic size={14} strokeWidth={1.8} />}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
