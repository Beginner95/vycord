import { useState, type ReactNode } from 'react';
import { apiErrorText } from '@/services/api';
import { logger } from '@/utils/logger';
import { useT } from '@/i18n';

interface CreateServerFormProps {
  onCreate: (name: string, isPrivate: boolean) => Promise<void>;
  renderActions: (state: { canSubmit: boolean }) => ReactNode;
}

/** Поля формы создания сервера. Кнопки рисует вызывающая сторона и ОБЯЗАНА
 *  вернуть их внутрь этой формы (см. план этапа 2, решение D4): модалка —
 *  своим .modal-actions, мобильный экран — .form-screen-actions. */
export function CreateServerForm({ onCreate, renderActions }: CreateServerFormProps) {
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
      {renderActions({ canSubmit: name.trim().length > 0 })}
    </form>
  );
}
