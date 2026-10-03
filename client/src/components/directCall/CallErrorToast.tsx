import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDirectCallStore } from '@/stores/directCallStore';
import { useT } from '@/i18n';
import type { TKey } from '@/i18n';
import type { CallErrorCode } from '@/types/directCall';

const ERROR_KEYS: Partial<Record<CallErrorCode, TKey>> = {
  forbidden: 'directCall.errForbidden',
  offline: 'directCall.errOffline',
  busy: 'directCall.errBusy',
  internal: 'directCall.errInternal',
  rate_limited: 'directCall.errRateLimited',
};

const ERROR_TOAST_MS = 5000;

/** Ошибка постановки звонка: текст 5 с, затем сброс. not_found/invalid_state — молча. */
export function CallErrorToast() {
  const t = useT();
  const lastError = useDirectCallStore((s) => s.lastError);
  const clearError = useDirectCallStore((s) => s.clearError);
  const key = lastError ? ERROR_KEYS[lastError] : undefined;

  useEffect(() => {
    if (!lastError) return;
    const id = setTimeout(clearError, ERROR_TOAST_MS);
    return () => clearTimeout(id);
  }, [lastError, clearError]);

  if (!key) return null;
  return createPortal(<div className="error-toast call-error-toast" role="alert">{t(key)}</div>, document.body);
}
