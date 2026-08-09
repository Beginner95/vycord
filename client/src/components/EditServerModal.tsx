import { useRef, useState } from 'react';
import type { Server } from '@/types';
import { apiService, apiErrorText, resolveUploadUrl } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { AvatarCropModal } from '@/components/AvatarCropModal';
import { useT } from '@/i18n';
import './EditServerModal.css';

const ALLOWED_TYPES = ['image/png', 'image/jpeg'];
const MAX_FILE_BYTES = 2 * 1024 * 1024;

interface EditServerModalProps {
  server: Server;
  onClose: () => void;
}

export function EditServerModal({ server, onClose }: EditServerModalProps) {
  const t = useT();
  const [name, setName] = useState(server.name);
  const [isPrivate, setIsPrivate] = useState(server.is_private);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removingIcon, setRemovingIcon] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError(t('server.iconBadFormat'));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(t('server.iconTooLarge'));
      return;
    }
    setError(null);
    setCropFile(file);
  };

  const handleUploadIcon = async (blob: Blob): Promise<void> => {
    const updated = (await apiService.uploadServerIcon(server.id, blob)) as Server;
    useServerStore.getState().patchServer(server.id, { icon_url: updated.icon_url });
    setCropFile(null);
  };

  const handleRemoveIcon = async () => {
    setRemovingIcon(true);
    try {
      const updated = (await apiService.removeServerIcon(server.id)) as Server;
      useServerStore.getState().patchServer(server.id, { icon_url: updated.icon_url });
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setRemovingIcon(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed === server.name && isPrivate === server.is_private) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const updated = (await apiService.updateServer(server.id, trimmed, isPrivate)) as Server;
      useServerStore.getState().patchServer(server.id, { name: updated.name, is_private: updated.is_private });
      onClose();
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>{t('server.editTitle')}</h2>

          <div className="edit-server-icon-block">
            {server.icon_url ? (
              <img src={resolveUploadUrl(server.icon_url)} alt={server.name} className="edit-server-icon-preview" />
            ) : (
              <div className="edit-server-icon-preview">{server.name.charAt(0).toUpperCase()}</div>
            )}
            <div className="edit-server-icon-actions">
              <button
                type="button"
                className="edit-server-icon-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                {t('server.changeIcon')}
              </button>
              {server.icon_url && (
                <button
                  type="button"
                  className="edit-server-icon-btn danger"
                  onClick={handleRemoveIcon}
                  disabled={removingIcon}
                >
                  {removingIcon ? t('common.removing') : t('server.removeIcon')}
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="edit-server-name">{t('server.nameLabel')}</label>
              <input
                id="edit-server-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                autoFocus
                required
              />
            </div>
            <div className="form-group form-checkbox">
              <label>
                <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                {t('server.privateLabel')}
              </label>
              {isPrivate && <p className="modal-hint">{t('server.privateHint')}</p>}
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

      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          title={t('server.cropIconTitle')}
          onCancel={() => setCropFile(null)}
          onUpload={handleUploadIcon}
        />
      )}
    </>
  );
}
