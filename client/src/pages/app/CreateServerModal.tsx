import { useT } from '@/i18n';
import { CreateServerForm } from './CreateServerForm';

interface CreateServerModalProps {
  onClose: () => void;
  onCreate: (name: string, isPrivate: boolean) => Promise<void>;
}

export function CreateServerModal({ onClose, onCreate }: CreateServerModalProps) {
  const t = useT();
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t('server.create')}</h2>
        <CreateServerForm
          onCreate={onCreate}
          renderActions={() => (
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button type="submit" className="btn btn-primary">
                {t('server.createSubmit')}
              </button>
            </div>
          )}
        />
      </div>
    </div>
  );
}
