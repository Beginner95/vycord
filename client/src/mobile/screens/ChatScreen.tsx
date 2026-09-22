import { Headphones, Search } from 'lucide-react';
import { ChatArea } from '@/components/ChatArea';
import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { useCoarsePointer } from '@/mobile/pointer';
import { useCallStore } from '@/stores/callStore';
import { useT, useTp } from '@/i18n';
import type { ScreenCtx } from './types';
import './ChatScreen.css';

/** Экран `chat` (спека §5.4): ChatArea в мобильной раскладке. */
export function ChatScreen({ channelId, ctx }: { channelId: string; ctx: ScreenCtx }) {
  const { c, nav, joinVoice } = ctx;
  const t = useT();
  const tp = useTp();
  const coarse = useCoarsePointer();
  const callChannelId = useCallStore((s) => s.callChannelId);
  const channel = c.currentChannel?.id === channelId ? c.currentChannel : null;
  if (!channel) return <div className="mobile-screen-loading" />;

  const inThisCall = callChannelId === channelId;
  const inCall = c.voiceParticipants.get(channelId)?.length ?? 0;
  const serverName = c.currentServer?.name ?? '';
  const subtitle = inCall > 0
    ? t('mobile.chatSubtitleCall', { server: serverName, count: String(inCall) })
    : `${serverName} · ${tp('call.participants', c.members.length)}`;
  // Чат — верхний экран стека: только тогда он принимает команды палитры (D9).
  const active = nav.top.kind === 'chat' && nav.top.channelId === channelId;

  return (
    <ChatArea
      channel={channel}
      user={c.user}
      active={active}
      header={({ openSearch }) => (
        <ScreenHeader
          title={`#${channel.name}`}
          subtitle={subtitle}
          onBack={nav.back}
          onTitleClick={() => nav.push({ kind: 'channelInfo', channelId })}
          actions={
            <>
              <button
                type="button"
                className={`screen-header-btn${inThisCall ? ' is-in-call' : ''}`}
                aria-label={inThisCall ? t('call.showCall') : t('call.joinVoice')}
                onClick={() => (inThisCall ? nav.push({ kind: 'call' }) : joinVoice(channel))}
              >
                <Headphones size={22} strokeWidth={1.8} />
              </button>
              <button type="button" className="screen-header-btn" aria-label={t('chat.searchMessages')} onClick={openSearch}>
                <Search size={22} strokeWidth={1.8} />
              </button>
            </>
          }
        />
      )}
      searchMode="screen"
      messageActions="sheet"
      composerVariant="mobile"
      enterSends={!coarse}
      historyOverlays
      onJoinVoice={joinVoice}
      onShowCall={inThisCall ? () => nav.push({ kind: 'call' }) : undefined}
      onCreateServer={() => nav.push({ kind: 'createServer' })}
      onFindServer={() => nav.push({ kind: 'findServer' })}
      voiceParticipants={c.voiceParticipants}
    />
  );
}
