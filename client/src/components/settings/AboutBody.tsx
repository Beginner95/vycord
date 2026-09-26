import { ArrowUpRight } from 'lucide-react';
import { useT } from '@/i18n';
import './AboutBody.css';

const GITHUB_URL = 'https://github.com/Beginner95/vycord';
const ISSUES_URL = `${GITHUB_URL}/issues`;

export function AboutBody() {
  const t = useT();
  return (
    <div className="settings-section">
      <div className="about-header">
        <img src="/icon.png" alt="" className="about-logo" />
        <span className="about-name">Vycord</span>
        <p className="about-description">{t('settings.aboutDescription')}</p>
      </div>

      <div className="setting-row">
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.aboutVersionLabel')}</span>
        </div>
        <span className="setting-row-value">{__APP_VERSION__}</span>
      </div>

      <a
        className="setting-row setting-row-link"
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.aboutGithub')}</span>
        </div>
        <ArrowUpRight size={16} strokeWidth={1.8} className="setting-row-link-icon" />
      </a>

      <a
        className="setting-row setting-row-link"
        href={ISSUES_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.aboutReportIssue')}</span>
        </div>
        <ArrowUpRight size={16} strokeWidth={1.8} className="setting-row-link-icon" />
      </a>
    </div>
  );
}