import { useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useLocaleStore, type Locale } from '@/stores/localeStore';
import { useT } from '@/i18n';
import { apiService, apiErrorText } from '@/services/api';
import { Avatar } from '@/components/Avatar';
import { AvatarCropModal } from '@/components/AvatarCropModal';
import './ProfileSettings.css';

const ALLOWED_TYPES = ['image/png', 'image/jpeg'];
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function ProfileSettings() {
  const { user, updateUser } = useAuthStore();
  const { locale, setLocale } = useLocaleStore();
  const t = useT();
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    <div className="profile-settings">
      <div className="profile-avatar-block">
        <Avatar url={user?.avatar_url} username={user?.username ?? ''} className="profile-avatar-large" />
        <div className="profile-avatar-actions">
          <button
            type="button"
            className="profile-avatar-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            {t('settings.changeAvatar')}
          </button>
          {user?.avatar_url && (
            <button
              type="button"
              className="profile-avatar-btn secondary"
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
        <h3>{t('settings.account')}</h3>
        <div className="setting-item">
          <div className="setting-info">
            <label>{t('settings.usernameLabel')}</label>
            <p className="setting-description">{user?.username}</p>
          </div>
        </div>
        <div className="setting-item">
          <div className="setting-info">
            <label>{t('settings.emailLabel')}</label>
            <p className="setting-description">{user?.email}</p>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>{t('settings.language')}</h3>
        <div className="setting-item">
          <div className="setting-info">
            <label>{t('settings.interfaceLanguage')}</label>
            <p className="setting-description">{t('settings.languageDescription')}</p>
          </div>
          <select
            className="setting-select"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            <option value="ru">{t('settings.languageNameRu')}</option>
            <option value="en">{t('settings.languageNameEn')}</option>
          </select>
        </div>
      </div>

      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onUpload={handleUpload}
        />
      )}
    </div>
  );
}
