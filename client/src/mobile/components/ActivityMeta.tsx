import { useT, useDateFormat, isSameCalendarDay } from '@/i18n';
import type { ChannelActivity } from '@/mobile/activity';

/** Подзаголовок строки: «Автор: текст» / «Автор: Вложение» и т.д. */
export function useActivitySubtitle(activity: ChannelActivity | null): string | null {
  const t = useT();
  const p = activity?.preview;
  if (!p) return null;
  const body = p.kind === 'text'
    ? (p.text ?? '')
    : p.kind === 'attachment'
      ? t('mobile.activityAttachment')
      : p.kind === 'sticker'
        ? t('mobile.activitySticker')
        : t('mobile.activityCall');
  return t('mobile.activityPreview', { author: p.authorName, text: body });
}

/** Правая колонка строки: время и бейдж/точка непрочитанного. */
export function ActivityMeta({ activity }: { activity: ChannelActivity | null }) {
  const t = useT();
  const { formatTime, formatDayMonth } = useDateFormat();
  if (!activity) return null;
  const when = activity.timestamp ? new Date(activity.timestamp) : null;
  const timeText = when && !Number.isNaN(when.getTime())
    ? (isSameCalendarDay(when, new Date()) ? formatTime(when) : formatDayMonth(when))
    : null;
  const count = activity.unreadCount;
  return (
    <>
      {timeText && <span className="activity-time">{timeText}</span>}
      {count !== null && count > 0 && (
        <span className="activity-badge" role="img" aria-label={t('mobile.unreadCount', { count: String(count) })}>
          {count > 99 ? '99+' : count}
        </span>
      )}
      {count === null && activity.hasUnread && (
        <span className="activity-dot" role="img" aria-label={t('mobile.hasUnread')} />
      )}
    </>
  );
}
