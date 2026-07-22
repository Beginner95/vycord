import { useEffect, useRef, useState } from 'react';
import { groupCallService } from '@/services/groupCall';
import { callService } from '@/services/call';
import './UpdateBanner.css';

type UpdateStatus = 'idle' | 'available' | 'ready' | 'error';

const CALL_POLL_INTERVAL_MS = 5000;

function isBusyWithCall(): boolean {
  return groupCallService.isInGroupCallState || callService.isInCallState;
}

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [version, setVersion] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [waitingForCallEnd, setWaitingForCallEnd] = useState(false);
  const [installRequested, setInstallRequested] = useState(false);
  const pollRef = useRef<number | null>(null);
  const installRequestedRef = useRef(false);

  const startInstall = () => {
    const api = window.electronAPI?.update;
    if (!api || pollRef.current !== null) return;

    if (isBusyWithCall()) {
      setWaitingForCallEnd(true);
      pollRef.current = window.setInterval(() => {
        if (!isBusyWithCall()) {
          if (pollRef.current !== null) window.clearInterval(pollRef.current);
          pollRef.current = null;
          setWaitingForCallEnd(false);
          api.confirmInstall();
        }
      }, CALL_POLL_INTERVAL_MS);
    } else {
      api.confirmInstall();
    }
  };

  useEffect(() => {
    const api = window.electronAPI?.update;
    if (!api) return;

    api.onAvailable((v) => {
      setVersion(v);
      setStatus('available');
      setDismissed(false);
    });
    api.onReady((v) => {
      setVersion(v);
      setStatus('ready');
      setDismissed(false);
      if (installRequestedRef.current) {
        installRequestedRef.current = false;
        setInstallRequested(false);
        startInstall();
      }
    });
    api.onError(() => {
      installRequestedRef.current = false;
      setInstallRequested(false);
      setStatus('error');
      setDismissed(false);
    });

    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, []);

  const handleAvailableInstallClick = () => {
    installRequestedRef.current = true;
    setInstallRequested(true);
  };

  const handleManualDownload = () => {
    window.electronAPI?.update?.openReleasesPage();
  };

  if (!window.electronAPI?.update || dismissed || status === 'idle') {
    return null;
  }

  return (
    <div className="update-banner" role="status">
      {status === 'available' && (
        <>
          <span>
            {installRequested
              ? `Скачивание обновления ${version}... установится автоматически`
              : `Доступна версия ${version}`}
          </span>
          {!installRequested && (
            <>
              <button onClick={handleAvailableInstallClick}>Установить</button>
              <button className="update-banner__dismiss" onClick={() => setDismissed(true)}>
                Позже
              </button>
            </>
          )}
        </>
      )}
      {status === 'ready' && (
        <>
          <span>
            {waitingForCallEnd
              ? `Обновление ${version} установится после звонка`
              : `Обновление ${version} готово`}
          </span>
          {!waitingForCallEnd && <button onClick={startInstall}>Перезапустить и установить</button>}
        </>
      )}
      {status === 'error' && (
        <>
          <span>Не удалось обновиться автоматически</span>
          <button onClick={handleManualDownload}>Скачать вручную</button>
        </>
      )}
    </div>
  );
}
