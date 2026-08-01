import { useT } from '@/i18n';

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
          <button onClick={handleMinimize} title={t('common.minimize')}>─</button>
          <button onClick={handleMaximize} title={t('common.maximize')}>□</button>
          <button className="close" onClick={handleClose} title={t('common.close')}>✕</button>
        </>
      )}
    </div>
  );
}
