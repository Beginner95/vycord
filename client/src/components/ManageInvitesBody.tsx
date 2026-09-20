import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Copy, Trash2 } from 'lucide-react';
import type { Invite } from '@/types';
import { apiService, apiErrorText } from '@/services/api';
import { useT } from '@/i18n';
import { inviteExpiry } from '@/utils/inviteExpiry';
import './ManageInvitesModal.css';

interface ManageInvitesBodyProps {
  serverId: string;
  /** Модалка: `.modal-actions`; экран: `.form-screen-actions`. */
  renderActions: (api: { creating: boolean; create: () => void }) => ReactNode;
  /** Мобильный экран кладёт сюда карточку «Пригласить друзей» (D3). Рисуется
   *  перед ошибкой и только если передан — в десктопной модалке узла нет. */
  header?: ReactNode;
}

/** Тело «Инвайт-ссылки»: ошибка, список ссылок с копированием и отзывом,
 *  создание. Общее для десктопной модалки (ManageInvitesModal) и мобильного
 *  экрана (InvitesScreen, VYC-95). Оболочка — заголовок и оверлей — остаётся у
 *  хоста; кнопки рисует `renderActions`. */
export function ManageInvitesBody({ serverId, renderActions, header }: ManageInvitesBodyProps) {
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
    <>
      {header}
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
      {renderActions({ creating, create: handleCreate })}
    </>
  );
}
