import { ChevronDown } from 'lucide-react';
import { useThemeStore } from '@/stores/themeStore';
import { useT } from '@/i18n';

export function AppearanceSettings() {
  const { theme, setTheme } = useThemeStore();
  const t = useT();

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t('settings.appearance')}</h3>

      <div className="setting-row">
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.theme')}</span>
          <p className="setting-row-desc">{t('settings.themeDescription')}</p>
        </div>
        <span className="select-wrap">
          <select
            className="select-control"
            aria-label={t('settings.theme')}
            value={theme}
            onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}
          >
            <option value="dark">{t('settings.themeDark')}</option>
            <option value="light">{t('settings.themeLight')}</option>
          </select>
          <span className="select-chevron">
            <ChevronDown size={14} strokeWidth={1.8} />
          </span>
        </span>
      </div>
    </div>
  );
}
