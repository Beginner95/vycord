import { X } from 'lucide-react';
import { useT } from '@/i18n';
import { ManageInvitesBody } from './ManageInvitesBody';
import './ManageInvitesModal.css';

interface ManageInvitesModalProps {
  serverId: string;
  onClose: () => void;
}

export function ManageInvitesModal({ serverId, onClose }: ManageInvitesModalProps) {
  const t = useT();

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
        <ManageInvitesBody
          serverId={serverId}
          renderActions={({ creating, create }) => (
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={create} disabled={creating}>
                {creating ? t('common.saving') : t('server.invites.create')}
              </button>
            </div>
          )}
        />
      </div>
    </div>
  );
}
