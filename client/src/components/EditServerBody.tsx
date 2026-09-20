import { useRef, useState, type ReactNode } from 'react';
import type { Server } from '@/types';
import { apiService, apiErrorText, resolveUploadUrl } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { useT } from '@/i18n';
import './EditServerModal.css';

const ALLOWED_TYPES = ['image/png', 'image/jpeg'];
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Загрузка обрезанной иконки. Живёт вне тела: окном кропа владеет вызывающая
 *  сторона (модалка — сестрой оверлея, мобильный экран — поверх себя), она же
 *  закрывает кроп после успеха. */
export async function uploadServerIcon(serverId: string, blob: Blob): Promise<void> {
  const updated = (await apiService.uploadServerIcon(serverId, blob)) as Server;
  useServerStore.getState().patchServer(serverId, { icon_url: updated.icon_url });
}

interface EditServerBodyProps {
  server: Server;
  /** Успешное сохранение / правок не было. */
  onDone: () => void;
  /** Кнопки рисует оболочка, но внутри формы (план этапа 2, решение D4):
   *  type="submit" отправляет только форму, в которой лежит. */
  renderActions: (state: { saving: boolean }) => ReactNode;
  /** Файл выбран и прошёл проверку — кроп показывает ВЫЗЫВАЮЩАЯ сторона
   *  (модалка — сестрой оверлея, экран — поверх себя), тело им не владеет. */
  onCropFile: (file: File) => void;
  /** Фокус на поле имени при открытии. Десктоп — да (как раньше); мобильный
   *  экран передаёт false: клавиатура на входе закрывала бы тумблеры и кнопку
   *  иконки, ради которых на экран обычно и заходят. */
  autoFocusName?: boolean;
}

/** Содержимое настроек сервера: блок иконки и форма. Общее для десктопной
 *  модалки и мобильного экрана; возвращает фрагмент, чтобы DOM модалки остался
 *  прежним узел в узел. */
export function EditServerBody({ server, onDone, renderActions, onCropFile, autoFocusName = true }: EditServerBodyProps) {
  const t = useT();
  const [name, setName] = useState(server.name);
  const [isPrivate, setIsPrivate] = useState(server.is_private);
  // Гостевые ссылки сохраняются отдельным запросом: их выключение — не правка
  // названия, а отзыв всех ссылок сервера с выкидыванием гостей
  // (docs/superpowers/specs/2026-09-17-guest-call-link-design.md).
  const [guestLinks, setGuestLinks] = useState(server.guest_links_enabled);
  const [guestLinksSaving, setGuestLinksSaving] = useState(false);
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
    onCropFile(file);
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
      onDone();
      return;
    }
    setSaving(true);
    try {
      const updated = (await apiService.updateServer(server.id, trimmed, isPrivate)) as Server;
      useServerStore.getState().patchServer(server.id, { name: updated.name, is_private: updated.is_private });
      onDone();
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="edit-server-icon-block">
        {server.icon_url ? (
          <img src={resolveUploadUrl(server.icon_url)} alt={server.name} className="edit-server-icon-preview" />
        ) : (
          <div className="edit-server-icon-preview">{server.name.charAt(0).toUpperCase()}</div>
        )}
        <div className="edit-server-icon-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            {t('server.changeIcon')}
          </button>
          {server.icon_url && (
            <button
              type="button"
              className="btn btn-danger-soft"
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
            autoFocus={autoFocusName}
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
        <div className="form-group form-checkbox">
          <label>
            <input
              type="checkbox"
              checked={guestLinks}
              disabled={guestLinksSaving}
              onChange={async (e) => {
                const enabled = e.target.checked;
                setGuestLinks(enabled);
                setGuestLinksSaving(true);
                try {
                  const updated = await apiService.setServerGuestLinks(server.id, enabled);
                  useServerStore.getState().patchServer(server.id, {
                    guest_links_enabled: updated.guest_links_enabled,
                  });
                  setError(null);
                } catch (err) {
                  setGuestLinks(!enabled);
                  setError(apiErrorText(err, t));
                } finally {
                  setGuestLinksSaving(false);
                }
              }}
            />
            {t('guestInvite.serverToggle')}
          </label>
          <p className="modal-hint">{t('guestInvite.serverToggleHint')}</p>
        </div>
        {error && <p className="modal-error">{error}</p>}
        {renderActions({ saving })}
      </form>
    </>
  );
}
