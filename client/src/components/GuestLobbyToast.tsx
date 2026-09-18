import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useGuestManagementStore } from '@/stores/guestManagementStore';
import { useT, useTp } from '@/i18n';
import './GuestLobbyToast.css';

/**
 * Очередь лобби внутри звонка: гость ждёт, пока его впустят, и это видят все
 * участники — решает первый ответивший
 * (docs/superpowers/specs/2026-09-17-guest-call-link-design.md, раздел 2).
 *
 * Не оверлей: живёт в потоке над панелью управления, ничего не перекрывает и
 * не перехватывает Escape.
 */

const VISIBLE_LIMIT = 3;

export function GuestLobbyToast() {
  const t = useT();
  const tp = useTp();
  const lobby = useGuestManagementStore((s) => s.lobby);
  const admit = useGuestManagementStore((s) => s.admit);
  const reject = useGuestManagementStore((s) => s.reject);
  const [busy, setBusy] = useState<string | null>(null);

  if (lobby.length === 0) return null;

  const decide = async (guestId: string, action: 'admit' | 'reject') => {
    setBusy(guestId);
    try {
      await (action === 'admit' ? admit(guestId) : reject(guestId));
    } catch {
      // Решение мог принять кто-то другой — очередь всё равно обновится
      // событием хаба.
    } finally {
      setBusy(null);
    }
  };

  const visible = lobby.slice(0, VISIBLE_LIMIT);
  const hidden = lobby.length - visible.length;

  return (
    <div className="guest-lobby-toasts">
      {visible.map((entry) => (
        <div key={entry.guest_id} className="guest-lobby-toast">
          <UserPlus size={16} strokeWidth={1.8} className="guest-lobby-icon" />
          <span className="guest-lobby-name">{entry.display_name}</span>
          <span className="guest-lobby-badge">{t('guest.guestBadge')}</span>
          <span className="guest-lobby-text">{t('guestInvite.lobbyWants')}</span>
          <button
            type="button"
            className="btn btn-primary guest-lobby-action"
            disabled={busy === entry.guest_id}
            onClick={() => void decide(entry.guest_id, 'admit')}
          >
            {t('guestInvite.admit')}
          </button>
          <button
            type="button"
            className="btn btn-ghost guest-lobby-action"
            disabled={busy === entry.guest_id}
            onClick={() => void decide(entry.guest_id, 'reject')}
          >
            {t('guestInvite.decline')}
          </button>
        </div>
      ))}
      {hidden > 0 && <div className="guest-lobby-more">{tp('guestInvite.lobbyMore', hidden)}</div>}
    </div>
  );
}
