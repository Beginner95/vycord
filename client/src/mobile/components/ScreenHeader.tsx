import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useT } from '@/i18n';
import './ScreenHeader.css';

interface ScreenHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  actions?: ReactNode;
  onTitleClick?: () => void;
}

export function ScreenHeader({ title, subtitle, onBack, actions, onTitleClick }: ScreenHeaderProps) {
  const t = useT();
  const titleBody = (
    <>
      <h1 className="screen-header-name">{title}</h1>
      {subtitle && <div className="screen-header-sub">{subtitle}</div>}
    </>
  );
  return (
    <header className="screen-header">
      {onBack && (
        <button type="button" className="screen-header-btn" onClick={onBack} aria-label={t('common.back')}>
          <ChevronLeft size={24} strokeWidth={1.8} />
        </button>
      )}
      {onTitleClick
        ? <button type="button" className="screen-header-title is-tappable" onClick={onTitleClick}>{titleBody}</button>
        : <div className="screen-header-title">{titleBody}</div>}
      {actions && <div className="screen-header-actions">{actions}</div>}
    </header>
  );
}
