import { PhoneCall, Phone } from 'lucide-react';
import { useT, useDateFormat } from '@/i18n';
import { useLocaleStore } from '@/stores/localeStore';
import { formatCallDuration } from '@/i18n/format';
import type { ChatMessage } from '@/stores/messageStore';
import './CallEventRow.css';

interface CallEventRowProps {
  msg: ChatMessage;
  /** Display name of msg.user_id — the caller already resolves this the
   * same way MessageRow's displayName is resolved (members/userCache), so
   * this component doesn't do its own lookup. */
  starterName: string;
}

export function CallEventRow({ msg, starterName }: CallEventRowProps) {
  const t = useT();
  const { formatTime } = useDateFormat();
  const locale = useLocaleStore((s) => s.locale);
  const isActive = !msg.call_ended_at;
  const time = formatTime(new Date(msg.created_at));

  const label = isActive
    ? t('chat.callStarted', { name: starterName })
    : t('chat.callEnded', {
        name: starterName,
        duration: formatCallDuration(
          (new Date(msg.call_ended_at!).getTime() - new Date(msg.call_started_at!).getTime()) / 1000,
          locale,
        ),
      });

  return (
    <div className="call-event-row" role="note" aria-label={label}>
      <span className={`call-event-icon${isActive ? ' is-active' : ''}`}>
        {isActive ? <PhoneCall size={15} strokeWidth={1.8} /> : <Phone size={15} strokeWidth={1.8} />}
      </span>
      <span className="call-event-label">{label}</span>
      <span className="call-event-time">{time}</span>
    </div>
  );
}
