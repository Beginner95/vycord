import { useThemeStore } from '@/stores/themeStore';

export function AppearanceSettings() {
  const { theme, setTheme } = useThemeStore();

  return (
    <div className="settings-section">
      <h3>Appearance</h3>

      <div className="setting-item">
        <div className="setting-info">
          <label>Theme</label>
          <p className="setting-description">Choose between light and dark interface</p>
        </div>
        <select
          className="setting-select"
          value={theme}
          onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </div>
    </div>
  );
}
