import { useState } from 'react';
import { apiErrorText } from '@/services/api';
import { logger } from '@/utils/logger';
import { useT } from '@/i18n';

interface CreateServerModalProps {
  onClose: () => void;
  onCreate: (name: string, isPrivate: boolean) => Promise<void>;
}

export function CreateServerModal({ onClose, onCreate }: CreateServerModalProps) {
  const t = useT();
  const [name, setName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');

    try {
      await onCreate(name.trim(), isPrivate);
    } catch (err) {
      logger.error('Failed to create server:', err, { module: 'app' });
      setError(apiErrorText(err, t));
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t('server.create')}</h2>
        <form onSubmit={submit}>
          <div className="form-group">
            <label htmlFor="server-name">{t('server.nameLabel')}</label>
            <input
              id="server-name"
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              placeholder={t('server.namePlaceholder')}
              maxLength={100}
              autoFocus
              required
            />
          </div>
          <div className="form-group form-checkbox">
            <label>
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
              />
              {t('server.privateLabel')}
            </label>
          </div>
          {error && <p className="modal-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('server.createSubmit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
