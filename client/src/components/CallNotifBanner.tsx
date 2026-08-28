import { PhoneIncoming, X } from 'lucide-react';
import { useT } from '@/i18n';
import './CallNotifBanner.css';

interface CallNotifBannerProps {
  callerName: string;
  channelName: string;
  onJoin: () => void;
  onDismiss: () => void;
}

/** Баннер входящего звонка. Состоянием владеет AppPage (WS-событие voice_call_ring). */
export function CallNotifBanner({ callerName, channelName, onJoin, onDismiss }: CallNotifBannerProps) {
  const t = useT();

  return (
    <div className="call-notif-banner">
      <PhoneIncoming className="call-notif-icon" size={16} strokeWidth={1.8} />
      <span className="call-notif-text">
        <strong>{callerName}</strong> {t('call.invitesTo')}{' '}
        <strong>#{channelName}</strong>
      </span>
      <button type="button" className="call-notif-join btn btn-primary" onClick={onJoin}>
        {t('call.joinCall')}
      </button>
      <button
        type="button"
        className="modal-close-btn"
        onClick={onDismiss}
        aria-label={t('common.close')}
      >
        <X size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}
