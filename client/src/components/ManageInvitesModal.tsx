import { useEffect, useState } from 'react';
import { Check, Copy, Trash2, X } from 'lucide-react';
import type { Invite } from '@/types';
import { apiService, apiErrorText } from '@/services/api';
import { useT } from '@/i18n';
import { inviteExpiry } from '@/utils/inviteExpiry';
import './ManageInvitesModal.css';

interface ManageInvitesModalProps {
  serverId: string;
  onClose: () => void;
}

export function ManageInvitesModal({ serverId, onClose }: ManageInvitesModalProps) {
  const t = useT();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiService
      .listInvites(serverId)
      .then((list) => {
        if (!cancelled) setInvites(list);
      })
      .catch((err) => {
        if (!cancelled) setError(apiErrorText(err, t));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serverId, t]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const invite = await apiService.createInvite(serverId);
      setInvites((prev) => [invite, ...prev]);
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = (code: string) => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopiedCode(code);
    setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 2000);
  };

  const handleRevoke = async (code: string) => {
    try {
      await apiService.revokeInvite(serverId, code);
      setInvites((prev) => prev.filter((i) => i.code !== code));
    } catch (err) {
      setError(apiErrorText(err, t));
    }
  };

  // Срок жизни ссылки считается из expires_at сервера через общий inviteExpiry —
  // тот же util, что и у инвайт-карточки в списке участников (spec §5 M1).
  const expiryText = (expiresAt?: string) => {
    const exp = inviteExpiry(expiresAt);
    return exp.kind === 'never'
      ? t('server.inviteCard.noExpiry')
      : t('server.inviteCard.expiresDays', { days: String(exp.days) });
  };

  return (
    <div className="modal-overlay">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{t('server.invites.title')}</h2>
          <button
            type="button"
            className="modal-close-btn"
            title={t('common.close')}
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
        {error && <p className="modal-error">{error}</p>}
        {loading ? (
          <p className="invites-empty">{t('common.loading')}</p>
        ) : invites.length === 0 ? (
          <p className="invites-empty">{t('server.invites.empty')}</p>
        ) : (
          <ul className="invites-list">
            {invites.map((invite) => (
              <li key={invite.code} className="invites-row">
                <div className="invites-row-main">
                  <span className="invites-code">{invite.code}</span>
                  <span className="invites-meta">
                    {t('server.invites.usesCount', { count: String(invite.uses) })}
                    {' · '}
                    {expiryText(invite.expires_at)}
                  </span>
                </div>
                <div className="invites-actions">
                  <button
                    type="button"
                    className="panel-icon-btn"
                    title={
                      copiedCode === invite.code
                        ? t('server.invites.copied')
                        : t('server.invites.copy')
                    }
                    aria-label={t('server.invites.copy')}
                    onClick={() => handleCopy(invite.code)}
                  >
                    {copiedCode === invite.code ? (
                      <Check size={15} strokeWidth={1.8} />
                    ) : (
                      <Copy size={15} strokeWidth={1.8} />
                    )}
                  </button>
                  <button
                    type="button"
                    className="panel-icon-btn is-danger"
                    title={t('server.invites.revoke')}
                    aria-label={t('server.invites.revoke')}
                    onClick={() => handleRevoke(invite.code)}
                  >
                    <Trash2 size={15} strokeWidth={1.8} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={handleCreate} disabled={creating}>
            {creating ? t('common.saving') : t('server.invites.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
