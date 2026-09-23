import { ChevronDown } from 'lucide-react';
import { useLocaleStore, type Locale } from '@/stores/localeStore';
import { useT } from '@/i18n';

/** Язык — вынесено из ProfileSettings.tsx (VYC-95 этап 5, T2). */
export function LanguageBody() {
  const { locale, setLocale } = useLocaleStore();
  const t = useT();
  return (
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
            aria-label={t('settings.interfaceLanguage')}
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
  );
}
