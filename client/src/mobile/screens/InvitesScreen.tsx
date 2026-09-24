import { useState } from 'react';
import type { Invite } from '@/types';
import { apiService, apiErrorText } from '@/services/api';
import { inviteExpiry } from '@/utils/inviteExpiry';
import { useT } from '@/i18n';
import { FormScreen } from '@/mobile/components/FormScreen';
import { ManageInvitesBody } from '@/components/ManageInvitesBody';
import './InvitesScreen.css';

/** Карточка «Пригласить друзей»: создаёт ссылку при первом копировании — тот
 *  же поток, что у .invite-card в UserList на десктопе (спека строка 12). */
function InviteFriendsCard({ serverId }: { serverId: string }) {
  const t = useT();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    setError('');
    let inv = invite;
    if (!inv) {
      setBusy(true);
      try {
        inv = await apiService.createInvite(serverId);
        setInvite(inv);
      } catch (err) {
        setError(apiErrorText(err, t));
        return;
      } finally {
        setBusy(false);
      }
    }
    navigator.clipboard?.writeText(inv.code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sub = (() => {
    if (!invite) return t('server.inviteCard.hint');
    const exp = inviteExpiry(invite.expires_at);
    return exp.kind === 'never'
      ? t('server.inviteCard.noExpiry')
      : t('server.inviteCard.expiresDays', { days: String(exp.days) });
  })();

  return (
    <div className="invite-friends-card">
      <span className="invite-friends-title">{t('server.inviteCard.title')}</span>
      <p className="invite-friends-sub">{sub}</p>
      {error && <p className="modal-error">{error}</p>}
      <button type="button" className="btn btn-secondary" onClick={() => void copy()} disabled={busy}>
        {copied ? t('server.invites.copied') : t('server.inviteCard.copyLink')}
      </button>
    </div>
  );
}

export function InvitesScreen({ serverId, onBack }: { serverId: string; onBack: () => void }) {
  const t = useT();
  return (
    <FormScreen title={t('server.invites.title')} onBack={onBack}>
      <ManageInvitesBody
        serverId={serverId}
        header={<InviteFriendsCard serverId={serverId} />}
        renderActions={({ creating, create }) => (
          <div className="form-screen-actions">
            <button type="button" className="btn btn-primary" onClick={create} disabled={creating}>
              {creating ? t('common.saving') : t('server.invites.create')}
            </button>
          </div>
        )}
      />
    </FormScreen>
  );
}
