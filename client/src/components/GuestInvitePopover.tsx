import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Check, Link2Off, UserMinus, Ban } from 'lucide-react';
import { useGuestManagementStore } from '@/stores/guestManagementStore';
import { apiErrorText } from '@/services/api';
import { useT } from '@/i18n';
import { useDismissOnOutside } from '@/hooks/useDismissOnOutside';
import './GuestInvitePopover.css';

/**
 * Управление гостями звонка: выпустить ссылку, скопировать, отозвать, выгнать.
 * Монтируется только пока открыт — таков контракт useDismissOnOutside
 * (client/docs/design-system.md, «Overlays»).
 *
 * Секрет ссылки существует только здесь и только до закрытия поповера: сервер
 * отдаёт его ровно один раз.
 */
interface GuestInvitePopoverProps {
  channelId: string;
  position: { top: number; left: number };
  onClose: () => void;
}

export function GuestInvitePopover({ channelId, position, onClose }: GuestInvitePopoverProps) {
  const t = useT();
  const links = useGuestManagementStore((s) => s.links);
  const guests = useGuestManagementStore((s) => s.guests);
  const lastLink = useGuestManagementStore((s) => s.lastLink);
  const createLink = useGuestManagementStore((s) => s.createLink);
  const refresh = useGuestManagementStore((s) => s.refresh);
  const revoke = useGuestManagementStore((s) => s.revoke);
  const kick = useGuestManagementStore((s) => s.kick);

  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const containerRef = useDismissOnOutside<HTMLDivElement>(onClose);

  useEffect(() => {
    void refresh(channelId).catch(setError);
  }, [channelId, refresh]);

  const create = async () => {
    setBusy(true);
    try {
      const link = await createLink(channelId);
      if (link) {
        await navigator.clipboard?.writeText(link.url).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!lastLink) return;
    await navigator.clipboard?.writeText(lastLink.url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return createPortal(
    <div
      className="guest-invite-popover"
      ref={containerRef}
      style={{ top: position.top, left: position.left }}
    >
      <div className="guest-invite-head">{t('guestInvite.title')}</div>
      <p className="guest-invite-hint">{t('guestInvite.hint')}</p>

      {lastLink ? (
        <div className="guest-invite-link">
          <input className="input" readOnly value={lastLink.url} onFocus={(e) => e.target.select()} />
          <button type="button" className="btn btn-primary guest-invite-copy" onClick={() => void copy()}>
            {copied ? <Check size={16} strokeWidth={1.8} /> : <Copy size={16} strokeWidth={1.8} />}
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void create()}>
          {t('guestInvite.create')}
        </button>
      )}

      {links.length > 0 && (
        <div className="guest-invite-section">
          <div className="guest-invite-section-title">{t('guestInvite.myLinks')}</div>
          {links.map((link) => (
            <div key={link.id} className="guest-invite-row">
              <span className="guest-invite-row-name">
                {link.closed_at ? t('guestInvite.linkClosed') : t('guestInvite.linkActive')}
              </span>
              <button
                type="button"
                className="btn btn-ghost guest-invite-action"
                title={t('guestInvite.revoke')}
                onClick={() => void revoke(link.id).catch(setError)}
              >
                <Link2Off size={15} strokeWidth={1.8} />
              </button>
            </div>
          ))}
        </div>
      )}

      {guests.length > 0 && (
        <div className="guest-invite-section">
          <div className="guest-invite-section-title">{t('guestInvite.guests')}</div>
          {guests.map((guest) => (
            <div key={guest.id} className="guest-invite-row">
              <span className="guest-invite-row-name">{guest.display_name}</span>
              <span className="guest-invite-badge">{t('guest.guestBadge')}</span>
              <button
                type="button"
                className="btn btn-ghost guest-invite-action"
                title={t('guestInvite.kick')}
                onClick={() => void kick(guest.id, false).catch(setError)}
              >
                <UserMinus size={15} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="btn btn-ghost guest-invite-action"
                title={t('guestInvite.kickAndBan')}
                onClick={() => void kick(guest.id, true).catch(setError)}
              >
                <Ban size={15} strokeWidth={1.8} />
              </button>
            </div>
          ))}
        </div>
      )}

      {error != null && <p className="guest-invite-error">{apiErrorText(error, t)}</p>}
    </div>,
    document.body,
  );
}
