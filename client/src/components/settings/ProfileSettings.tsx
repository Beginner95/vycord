import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
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
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">{t('settings.language')}</h3>
        <div className="setting-row">
          <div className="setting-row-info">
            <span className="setting-row-title">{t('settings.interfaceLanguage')}</span>
            <p className="setting-row-desc">{t('settings.languageDescription')}</p>
          </div>
          <span className="select-wrap">
            <select
              className="select-control"
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
            >
              <option value="ru">{t('settings.languageNameRu')}</option>
              <option value="en">{t('settings.languageNameEn')}</option>
            </select>
            <span className="select-chevron">
              <ChevronDown size={14} strokeWidth={1.8} />
            </span>
          </span>
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
