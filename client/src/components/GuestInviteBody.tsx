import { useEffect, useState } from 'react';
import { Copy, Check, Link2Off, UserMinus, Ban } from 'lucide-react';
import { useGuestManagementStore } from '@/stores/guestManagementStore';
import { apiErrorText } from '@/services/api';
import { useT } from '@/i18n';

export interface GuestInviteBodyProps {
  channelId: string;
}

/**
 * Тело управления гостями звонка без поверхности: `GuestInvitePopover`
 * оборачивает его в поповер-портал, мобильная шторка (`MobileGuestSheet`) —
 * в `BottomSheet`.
 *
 * Рендерит Fragment, а не оборачивающий div: `GuestInvitePopover.css`
 * стилизует эти классы (`guest-invite-hint`, `-link`, `-section`, `-row`,
 * `-error`, …) плоско, без `>`-комбинаторов и без зависимости от того, что
 * они прямые дети `.guest-invite-popover` — так что обёртка не нужна и не
 * меняла бы визуально ничего, кроме DOM-дерева десктопа, которое должно
 * остаться байт-в-байт тем же.
 */
export function GuestInviteBody({ channelId }: GuestInviteBodyProps) {
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

  return (
    <>
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
    </>
  );
}
