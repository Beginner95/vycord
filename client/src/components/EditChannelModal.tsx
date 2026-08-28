import { useState } from 'react';
import type { Channel } from '@/types';
import { apiService, apiErrorText } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { useT } from '@/i18n';

interface EditChannelModalProps {
  serverId: string;
  channel: Channel;
  onClose: () => void;
}

export function EditChannelModal({ serverId, channel, onClose }: EditChannelModalProps) {
  const t = useT();
  const [name, setName] = useState(channel.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === channel.name) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const updated = (await apiService.updateChannel(serverId, channel.id, trimmed)) as Channel;
      useServerStore.getState().patchChannel(channel.id, { name: updated.name });
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
        <h2>{t('channel.editTitle')}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="edit-channel-name">{t('channel.nameLabel')}</label>
            <input
              id="edit-channel-name"
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
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
