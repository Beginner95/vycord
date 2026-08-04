import { useState } from 'react';
import type { Channel, PermissionSet } from '@/types';
import { apiService, apiErrorText } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { canManageChannelPrivacy } from '@/utils/permissions';
import { useT } from '@/i18n';

interface EditChannelModalProps {
  serverId: string;
  channel: Channel;
  userId: string | undefined;
  permissions: PermissionSet | undefined;
  onClose: () => void;
}

export function EditChannelModal({ serverId, channel, userId, permissions, onClose }: EditChannelModalProps) {
  const t = useT();
  const [name, setName] = useState(channel.name);
  const [isPrivate, setIsPrivate] = useState(channel.is_private);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canEditPrivacy = canManageChannelPrivacy(permissions, channel, userId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed === channel.name && isPrivate === channel.is_private) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const updated = (await apiService.updateChannel(serverId, channel.id, trimmed, isPrivate)) as Channel;
      useServerStore.getState().patchChannel(channel.id, { name: updated.name, is_private: updated.is_private });
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
          <div className="form-group form-checkbox">
            <label title={canEditPrivacy ? undefined : t('channel.privateDisabledHint')}>
              <input
                type="checkbox"
                checked={isPrivate}
                disabled={!canEditPrivacy}
                onChange={(e) => setIsPrivate(e.target.checked)}
              />
              {t('channel.privateLabel')}
            </label>
          </div>
          {error && <p className="modal-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
