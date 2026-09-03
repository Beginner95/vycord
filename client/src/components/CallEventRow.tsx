import { PhoneCall, Phone } from 'lucide-react';
import { useT, useDateFormat } from '@/i18n';
import { useLocaleStore } from '@/stores/localeStore';
import { formatCallDuration } from '@/i18n/format';
import type { ChatMessage } from '@/stores/messageStore';
import './CallEventRow.css';

// tsconfig's lib target (ES2020) predates the ES2021 Intl.ListFormat types;
// the runtime API has been broadly available for years, so augment the
// ambient Intl namespace locally rather than bumping the project-wide lib.
declare namespace Intl {
  interface ListFormatOptions {
    localeMatcher?: 'lookup' | 'best fit';
    type?: 'conjunction' | 'disjunction' | 'unit';
    style?: 'long' | 'short' | 'narrow';
  }
  class ListFormat {
    constructor(locales?: string | string[], options?: ListFormatOptions);
    format(list: Iterable<string>): string;
  }
}

interface CallEventRowProps {
  msg: ChatMessage;
  /** Display name of msg.user_id — the caller already resolves this the
   * same way MessageRow's displayName is resolved (members/userCache), so
   * this component doesn't do its own lookup. */
  starterName: string;
  /** Display names of every OTHER participant (msg.user_id excluded),
   * resolved by the caller the same way as starterName. Ignored while the
   * call is active — the list is only shown once it ends, never
   * live-updated (design doc «Live-обновление»). Defaults to []. */
  participantNames?: string[];
}

export function CallEventRow({ msg, starterName, participantNames = [] }: CallEventRowProps) {
  const t = useT();
  const { formatTime } = useDateFormat();
  const locale = useLocaleStore((s) => s.locale);
  const isActive = !msg.call_ended_at;
  const time = formatTime(new Date(msg.created_at));

  let label: string;
  if (isActive) {
    label = t('chat.callStarted', { name: starterName });
  } else {
    const duration = formatCallDuration(
      (new Date(msg.call_ended_at!).getTime() - new Date(msg.call_started_at!).getTime()) / 1000,
      locale,
    );
    const others = participantNames.length > 0
      ? new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(participantNames)
      : null;
    label = others
      ? t('chat.callEndedWithParticipants', { name: starterName, others, duration })
      : t('chat.callEnded', { name: starterName, duration });
  }

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
