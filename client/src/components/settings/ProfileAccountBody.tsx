import { useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useT } from '@/i18n';
import { apiService, apiErrorText } from '@/services/api';
import { Avatar } from '@/components/Avatar';
import { AvatarCropModal } from '@/components/AvatarCropModal';

const ALLOWED_TYPES = ['image/png', 'image/jpeg'];
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Аватар + учётная запись — вынесено из ProfileSettings.tsx (VYC-95 этап 5,
 *  T2): тот же приём, что EditServerModal → EditServerBody в этапе 2. Тело
 *  монтируется и десктопным композером (ProfileSettings.tsx), и мобильным
 *  экраном settings{profile} (SettingsScreen.tsx, T5) — БЕЗ прохода через
 *  композер. ДОЛЖНО остаться DOM-идентичным Settings.dom.test.tsx (T1). */
export function ProfileAccountBody() {
  const { user, updateUser } = useAuthStore();
  const t = useT();
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phoneInput, setPhoneInput] = useState('');
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const closePhoneEditor = () => {
    setEditingPhone(false);
    setPhoneInput('');
    setPhoneError(null);
  };

  const savePhone = async () => {
    const value = phoneInput.trim();
    if (!value) return;
    setPhoneSaving(true);
    setPhoneError(null);
    try {
      const updated = await apiService.updatePhone(value);
      updateUser({ phone_masked: updated.phone_masked ?? null });
      closePhoneEditor();
    } catch (err) {
      setPhoneError(apiErrorText(err, t));
    } finally {
      setPhoneSaving(false);
    }
  };

  const removePhone = async () => {
    setPhoneSaving(true);
    setPhoneError(null);
    try {
      const updated = await apiService.deletePhone();
      updateUser({ phone_masked: updated.phone_masked ?? null });
    } catch (err) {
      setPhoneError(apiErrorText(err, t));
    } finally {
      setPhoneSaving(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setPickError(t('settings.avatarBadFormat'));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setPickError(t('settings.avatarTooLarge'));
      return;
    }

    setPickError(null);
    setCropFile(file);
  };

  const handleUpload = async (blob: Blob): Promise<void> => {
    const updated = await apiService.uploadAvatar(blob);
    updateUser({ avatar_url: updated.avatar_url });
    setCropFile(null);
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const updated = await apiService.removeAvatar();
      updateUser({ avatar_url: updated.avatar_url });
    } catch (err) {
      setPickError(apiErrorText(err, t));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <div className="profile-avatar-block">
        <Avatar url={user?.avatar_url} username={user?.username ?? ''} className="profile-avatar-large" />
        <div className="profile-avatar-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            {t('settings.changeAvatar')}
          </button>
          {user?.avatar_url && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleRemove}
              disabled={removing}
            >
              {removing ? t('settings.removingAvatar') : t('settings.removeAvatar')}
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
        {pickError && <p className="setting-warning">{pickError}</p>}
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">{t('settings.account')}</h3>
        <div className="setting-row">
          <div className="setting-row-info">
            <span className="setting-row-title">{t('settings.usernameLabel')}</span>
            <p className="setting-row-desc">{user?.username}</p>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-row-info">
            <span className="setting-row-title">{t('settings.emailLabel')}</span>
            <p className="setting-row-desc">{user?.email}</p>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-row-info">
            <span className="setting-row-title">{t('settings.phoneLabel')}</span>
            <p className="setting-row-desc">
              {user?.phone_masked ?? t('settings.phoneNotSet')}
            </p>
          </div>
          {editingPhone ? (
            <div className="phone-edit-row">
              <input
                className="input"
                value={phoneInput}
                onChange={(e) => { setPhoneInput(e.target.value); setPhoneError(null); }}
                placeholder="+7 …"
                autoFocus
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={savePhone}
                disabled={phoneSaving || !phoneInput.trim()}
              >
                {t('settings.phoneSave')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={closePhoneEditor}>
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <span className="phone-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEditingPhone(true)}>
                {user?.phone_masked ? t('settings.phoneEdit') : t('settings.phoneAdd')}
              </button>
              {user?.phone_masked && (
                <button type="button" className="btn btn-ghost" onClick={removePhone} disabled={phoneSaving}>
                  {t('settings.phoneRemove')}
                </button>
              )}
            </span>
          )}
        </div>
        {phoneError && <p className="setting-warning">{phoneError}</p>}
      </div>

      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onUpload={handleUpload}
        />
      )}
    </>
  );
}
