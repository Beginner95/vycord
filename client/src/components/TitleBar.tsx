import { Minus, Square, X } from 'lucide-react';
import { useT } from '@/i18n';
import './TitleBar.css';

export function TitleBar() {
  const t = useT();
  const isElectron = typeof window !== 'undefined' && window.electronAPI;

  const handleMinimize = () => {
    window.electronAPI?.minimizeWindow();
  };

  const handleMaximize = () => {
    window.electronAPI?.maximizeWindow();
  };

  const handleClose = () => {
    window.electronAPI?.closeWindow();
  };

  return (
    <div className="title-bar">
      {isElectron && (
        <>
          <button onClick={handleMinimize} title={t('common.minimize')}>
            <Minus size={15} strokeWidth={1.8} />
          </button>
          <button onClick={handleMaximize} title={t('common.maximize')}>
            <Square size={13} strokeWidth={1.8} />
          </button>
          <button className="title-bar-close" onClick={handleClose} title={t('common.close')}>
            <X size={15} strokeWidth={1.8} />
          </button>
        </>
      )}
    </div>
  );
}
