import { useThemeStore } from '@/stores/themeStore';
import { useT } from '@/i18n';

export function AppearanceSettings() {
  const { theme, setTheme } = useThemeStore();
  const t = useT();

  return (
    <div className="settings-section">
      <h3>{t('settings.appearance')}</h3>

      <div className="setting-item">
        <div className="setting-info">
          <label>{t('settings.theme')}</label>
          <p className="setting-description">{t('settings.themeDescription')}</p>
        </div>
        <select
          className="setting-select"
          value={theme}
          onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}
        >
          <option value="dark">{t('settings.themeDark')}</option>
          <option value="light">{t('settings.themeLight')}</option>
        </select>
      </div>
    </div>
  );
}
