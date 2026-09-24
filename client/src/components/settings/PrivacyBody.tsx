import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useT } from '@/i18n';
import { apiService, apiErrorText } from '@/services/api';
import type { PrivacyMode } from '@/types';

/** Приватность — вынесено из ProfileSettings.tsx (VYC-95 этап 5, T2). См.
 *  ProfileAccountBody.tsx — тот же приём и тот же контракт. */
export function PrivacyBody() {
  const { user, updateUser } = useAuthStore();
  const t = useT();
  const [privacyError, setPrivacyError] = useState<string | null>(null);

  const handleShowLastSeenChange = async (checked: boolean) => {
    const previous = user?.show_last_seen ?? true;
    updateUser({ show_last_seen: checked });
    setPrivacyError(null);
    try {
      await apiService.updatePrivacy({ show_last_seen: checked });
    } catch (err) {
      updateUser({ show_last_seen: previous });
      setPrivacyError(apiErrorText(err, t));
    }
  };

  const handleAllowFriendRequestsChange = async (value: PrivacyMode) => {
    const previous = user?.allow_friend_requests ?? 'everyone';
    updateUser({ allow_friend_requests: value });
    setPrivacyError(null);
    try {
      await apiService.updatePrivacy({ allow_friend_requests: value });
    } catch (err) {
      updateUser({ allow_friend_requests: previous });
      setPrivacyError(apiErrorText(err, t));
    }
  };

  const handleAllowDmFromChange = async (value: PrivacyMode) => {
    const previous = user?.allow_dm_from ?? 'friends';
    updateUser({ allow_dm_from: value });
    setPrivacyError(null);
    try {
      await apiService.updatePrivacy({ allow_dm_from: value });
    } catch (err) {
      updateUser({ allow_dm_from: previous });
      setPrivacyError(apiErrorText(err, t));
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t('settings.privacy')}</h3>
      <div className="setting-row">
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.showLastSeen')}</span>
          <p className="setting-row-desc">{t('settings.showLastSeenDescription')}</p>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            aria-label={t('settings.showLastSeen')}
            checked={user?.show_last_seen ?? true}
            onChange={(e) => { void handleShowLastSeenChange(e.target.checked); }}
          />
          <span className="toggle-track" />
        </label>
      </div>
      <div className="setting-row">
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.allowFriendRequests')}</span>
          <p className="setting-row-desc">{t('settings.allowFriendRequestsDescription')}</p>
        </div>
        <span className="select-wrap">
          <select
            className="select-control"
            aria-label={t('settings.allowFriendRequests')}
            value={user?.allow_friend_requests ?? 'everyone'}
            onChange={(e) => { void handleAllowFriendRequestsChange(e.target.value as PrivacyMode); }}
          >
            <option value="everyone">{t('settings.privacyEveryone')}</option>
            <option value="mutual_servers">{t('settings.privacyMutualServers')}</option>
            <option value="none">{t('settings.privacyNobody')}</option>
          </select>
          <span className="select-chevron">
            <ChevronDown size={14} strokeWidth={1.8} />
          </span>
        </span>
      </div>
      <div className="setting-row">
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.allowDmFrom')}</span>
          <p className="setting-row-desc">{t('settings.allowDmFromDescription')}</p>
        </div>
        <span className="select-wrap">
          <select
            className="select-control"
            aria-label={t('settings.allowDmFrom')}
            value={user?.allow_dm_from ?? 'friends'}
            onChange={(e) => { void handleAllowDmFromChange(e.target.value as PrivacyMode); }}
          >
            <option value="everyone">{t('settings.privacyEveryone')}</option>
            <option value="mutual_servers">{t('settings.privacyMutualServers')}</option>
            <option value="friends">{t('settings.privacyFriendsOnly')}</option>
          </select>
          <span className="select-chevron">
            <ChevronDown size={14} strokeWidth={1.8} />
          </span>
        </span>
      </div>
      {privacyError && <p className="setting-warning">{privacyError}</p>}
    </div>
  );
}
