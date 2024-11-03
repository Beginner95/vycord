export function TitleBar() {
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
          <button onClick={handleMinimize} title="Minimize">─</button>
          <button onClick={handleMaximize} title="Maximize">□</button>
          <button className="close" onClick={handleClose} title="Close">✕</button>
        </>
      )}
    </div>
  );
}
