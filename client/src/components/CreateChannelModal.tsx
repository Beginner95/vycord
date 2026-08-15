import { useState } from 'react';
import type { Channel } from '@/types';
import { apiService, apiErrorText } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { useT } from '@/i18n';

interface CreateChannelModalProps {
  serverId: string;
  onClose: () => void;
}

export function CreateChannelModal({ serverId, onClose }: CreateChannelModalProps) {
  const t = useT();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const channel = (await apiService.createChannel(serverId, trimmed)) as Channel;
      useServerStore.getState().addChannel(channel);
      onClose();
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t('channel.createTitle')}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="create-channel-name">{t('channel.nameLabel')}</label>
            <input
              id="create-channel-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoFocus
              required
            />
          </div>
          {error && <p className="modal-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="primary" disabled={saving || !name.trim()}>
              {saving ? t('common.saving') : t('channel.createButton')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
