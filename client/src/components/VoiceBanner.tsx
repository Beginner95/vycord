import { Avatar } from '@/components/Avatar';
import { useT } from '@/i18n';
import type { MemberWithUser } from '@/types';
import './VoiceBanner.css';

interface VoiceBannerProps {
  channelName: string;
  participantIds: string[];
  members: MemberWithUser[];
  inThisCall: boolean;
  onJoin: () => void;
  onShowCall?: () => void;
}

/** Board 1f: mobile-only voice banner — «В голосовом „Общий“ — 2» + join. */
export function VoiceBanner({ channelName, participantIds, members, inThisCall, onJoin, onShowCall }: VoiceBannerProps) {
  const t = useT();
  if (participantIds.length === 0) return null;
  const shown = participantIds.slice(0, 3);
  const action = inThisCall ? onShowCall : onJoin;
  return (
    <div className="voice-banner">
      <div className="voice-banner-avatars">
        {shown.map((id) => {
          const member = members.find((m) => m.user_id === id);
          return (
            <Avatar
              key={id}
              username={member?.username ?? id.slice(0, 8)}
              url={member?.avatar_url}
              className="voice-banner-avatar"
            />
          );
        })}
      </div>
      <span className="voice-banner-text">
        {t('call.voiceBanner', { channel: channelName, count: String(participantIds.length) })}
      </span>
      {action && (
        <button type="button" className="voice-banner-btn" onClick={action}>
          {inThisCall ? t('call.bannerGoToCall') : t('call.bannerJoin')}
        </button>
      )}
    </div>
  );
}
