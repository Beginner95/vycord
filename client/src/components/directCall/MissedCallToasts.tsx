import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PhoneMissed, Phone, X } from 'lucide-react';
import { useDirectCallStore } from '@/stores/directCallStore';
import { requestAttention } from '@/services/desktopAttention';
import { useT } from '@/i18n';
import './MissedCallToasts.css';

/** Пропущенные звонки: живут до закрытия, «Перезвонить» — новый вызов. */
export function MissedCallToasts() {
  const t = useT();
  const missed = useDirectCallStore((s) => s.missed);
  const call = useDirectCallStore((s) => s.call);
  const dismiss = useDirectCallStore((s) => s.dismissMissed);
  const notified = useRef(new Set<string>());

  useEffect(() => {
    for (const m of missed) {
      if (notified.current.has(m.callId)) continue;
      notified.current.add(m.callId);
      requestAttention(t('directCall.missedTitle'), t('directCall.missedFrom', { name: m.peer.username }));
    }
  }, [missed, t]);

  if (missed.length === 0) return null;
  return createPortal(
    <div className="missed-call-stack" aria-live="polite">
      {missed.map((m) => (
        <div key={m.callId} className="missed-call-toast">
          <PhoneMissed size={16} strokeWidth={1.8} className="missed-call-icon" />
          <span className="missed-call-text">{t('directCall.missedFrom', { name: m.peer.username })}</span>
          <button type="button" className="btn btn-primary missed-call-back" onClick={() => { dismiss(m.callId); call(m.peer); }}>
            <Phone size={14} strokeWidth={1.8} /> {t('directCall.callBack')}
          </button>
          <button type="button" className="modal-close-btn" onClick={() => dismiss(m.callId)} aria-label={t('common.close')}>
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
