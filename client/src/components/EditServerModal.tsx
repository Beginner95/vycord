import { useRef, useState } from 'react';
import type { Server } from '@/types';
import { apiService } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { AvatarCropModal } from '@/components/AvatarCropModal';
import './EditServerModal.css';

const ALLOWED_TYPES = ['image/png', 'image/jpeg'];
const MAX_FILE_BYTES = 2 * 1024 * 1024;

interface EditServerModalProps {
  server: Server;
  onClose: () => void;
}

export function EditServerModal({ server, onClose }: EditServerModalProps) {
  const [name, setName] = useState(server.name);
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
      setError('Неподдерживаемый формат. Разрешены PNG, JPG, JPEG');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('Файл слишком большой. Максимум 2 МБ');
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
      setError(err instanceof Error ? err.message : 'Не удалось удалить иконку');
    } finally {
      setRemovingIcon(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name.trim() === server.name) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const updated = (await apiService.updateServer(server.id, name.trim())) as Server;
      useServerStore.getState().patchServer(server.id, { name: updated.name });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось обновить сервер');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Редактировать сервер</h2>

          <div className="edit-server-icon-block">
            {server.icon_url ? (
              <img src={server.icon_url} alt={server.name} className="edit-server-icon-preview" />
            ) : (
              <div className="edit-server-icon-preview">{server.name.charAt(0).toUpperCase()}</div>
            )}
            <div className="edit-server-icon-actions">
              <button
                type="button"
                className="edit-server-icon-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                Изменить иконку
              </button>
              {server.icon_url && (
                <button
                  type="button"
                  className="edit-server-icon-btn danger"
                  onClick={handleRemoveIcon}
                  disabled={removingIcon}
                >
                  {removingIcon ? 'Удаление...' : 'Удалить иконку'}
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
              <label htmlFor="edit-server-name">Название сервера</label>
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
            {error && <p className="modal-error">{error}</p>}
            <div className="modal-actions">
              <button type="button" onClick={onClose}>
                Отмена
              </button>
              <button type="submit" className="primary" disabled={saving}>
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          title="Обрезка иконки сервера"
          onCancel={() => setCropFile(null)}
          onUpload={handleUploadIcon}
        />
      )}
    </>
  );
}
