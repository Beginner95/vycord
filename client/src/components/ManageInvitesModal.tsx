import { useEffect, useState } from 'react';
import type { Invite } from '@/types';
import { apiService, apiErrorText } from '@/services/api';
import { useT } from '@/i18n';
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

  return (
    <div className="modal-overlay">
      <div className="modal manage-invites-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t('server.invites.title')}</h2>
        {error && <p className="modal-error">{error}</p>}
        {loading ? (
          <p>{t('common.loading')}</p>
        ) : invites.length === 0 ? (
          <p className="search-empty">{t('server.invites.empty')}</p>
        ) : (
          <ul className="channel-access-list">
            {invites.map((invite) => (
              <li key={invite.code} className="channel-access-row">
                <div className="channel-access-info">
                  <span className="channel-access-code">{invite.code}</span>
                  <span className="channel-access-uses">
                    {t('server.invites.usesCount', { count: String(invite.uses) })}
                  </span>
                </div>
                <div className="channel-access-actions">
                  <button
                    type="button"
                    className={copiedCode === invite.code ? 'copied' : ''}
                    title={
                      copiedCode === invite.code
                        ? t('server.invites.copied')
                        : t('server.invites.copy')
                    }
                    aria-label={t('server.invites.copy')}
                    onClick={() => handleCopy(invite.code)}
                  >
                    {copiedCode === invite.code ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    )}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    title={t('server.invites.revoke')}
                    aria-label={t('server.invites.revoke')}
                    onClick={() => handleRevoke(invite.code)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions manage-invites-actions">
          <button type="button" onClick={onClose}>
            {t('common.close')}
          </button>
          <button type="button" className="primary" onClick={handleCreate} disabled={creating}>
            {creating ? t('common.saving') : t('server.invites.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
