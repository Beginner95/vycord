import type { ReactNode } from 'react';
import type { Channel } from '@/types';
import type { Screen } from '@/mobile/nav/types';
import type { MobileNav } from '@/mobile/nav/useMobileNav';
import type { AppController } from '@/pages/app/useAppController';
import { ServerList } from '@/components/ServerList';
import { ChannelSidebar } from '@/components/ChannelSidebar';
import { ChatArea } from '@/components/ChatArea';
import { CallStage } from '@/components/CallStage';
import { UserList } from '@/components/UserList';
import { HomeView } from '@/components/HomeView';
import { UserPanel } from '@/components/UserPanel';
import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { useCallStore } from '@/stores/callStore';
import { useT } from '@/i18n';

export interface ScreenCtx {
  c: AppController;
  nav: MobileNav;
  joinVoice: (channel: Channel) => void; // вход + экран звонка
}

function ProfileRoot({ c }: { c: AppController }) {
  const t = useT();
  return (
    <div className="mobile-profile">
      <ScreenHeader title={t('mobile.tabProfile')} />
      {/* Этап 1: панель пользователя (настройки, выход, NC). Полноценная
          вкладка — этап 5 (спека §5.8). */}
      <UserPanel user={c.user} onLogout={c.logout} onOpenSettings={() => c.ui.setSettingsOpen(true)} />
    </div>
  );
}

function ChannelsScreen({ serverId, ctx }: { serverId: string; ctx: ScreenCtx }) {
  const { c, nav, joinVoice } = ctx;
  if (c.currentServer?.id !== serverId) return <div className="mobile-screen-loading" />;
  return (
    <ChannelSidebar
      server={c.currentServer}
      channels={c.channels}
      currentChannel={c.currentChannel}
      onSelectChannel={(ch) => nav.push({ kind: 'chat', channelId: ch.id })}
      onJoinVoice={joinVoice}
      user={c.user}
      onMobileBack={nav.back}
      voiceParticipants={c.voiceParticipants}
      members={c.members}
      onChannelDeleted={c.channelRemoved}
      onServerDeleted={c.serverRemoved}
      onCreateChannel={() => c.ui.setCreateChannelOpen(true)}
    />
  );
}

function ChatScreen({ channelId, ctx }: { channelId: string; ctx: ScreenCtx }) {
  const { c, nav, joinVoice } = ctx;
  const callChannelId = useCallStore((s) => s.callChannelId);
  const channel = c.currentChannel?.id === channelId ? c.currentChannel : null;
  if (!channel) return <div className="mobile-screen-loading" />;
  return (
    <ChatArea
      channel={channel}
      user={c.user}
      onMobileBack={nav.back}
      onShowMembers={() => nav.push({ kind: 'channelInfo', channelId })}
      onJoinVoice={joinVoice}
      onShowCall={callChannelId === channelId ? () => nav.push({ kind: 'call' }) : undefined}
      onCreateServer={() => c.ui.setCreateServerOpen(true)}
      onFindServer={() => c.ui.setFindServerOpen(true)}
      voiceParticipants={c.voiceParticipants}
    />
  );
}

function CallScreen({ ctx }: { ctx: ScreenCtx }) {
  const callChannelId = useCallStore((s) => s.callChannelId);
  if (!callChannelId || callChannelId !== ctx.c.currentChannel?.id) return <div className="mobile-screen-loading" />;
  return <CallStage onMobileBackToChat={ctx.nav.back} />;
}

/** Этап 1: экраны стека монтируют существующие панели (спека §9 п.1).
 *  Экраны следующих этапов пока не достижимы — рендерят пустой каркас. */
export function renderScreen(screen: Screen, ctx: ScreenCtx): ReactNode {
  const { c, nav } = ctx;
  switch (screen.kind) {
    case 'servers':
      // На этом экране может быть открыт сервер (стек: servers → channels →
      // ...) — ServerList должен подсвечивать его, а не считать корень
      // безусловно "без активного сервера".
      return (
        <ServerList
          servers={c.servers}
          currentServer={c.currentServer}
          user={c.user}
          onSelectServer={(s) => nav.push({ kind: 'channels', serverId: s.id })}
          onCreateServer={() => c.ui.setCreateServerOpen(true)}
          onOpenFindServer={() => c.ui.setFindServerOpen(true)}
          onServerDeleted={c.serverRemoved}
          onSelectHome={() => nav.switchTab('friends')}
          pendingCount={c.pendingCount}
        />
      );
    case 'friends':
      return <HomeView />;
    case 'profile':
      return <ProfileRoot c={c} />;
    case 'channels':
      return <ChannelsScreen serverId={screen.serverId} ctx={ctx} />;
    case 'chat':
      return <ChatScreen channelId={screen.channelId} ctx={ctx} />;
    case 'channelInfo':
      return <UserList onMobileBack={nav.back} voiceParticipants={c.voiceParticipants} />;
    case 'call':
      return <CallScreen ctx={ctx} />;
    default:
      return <div className="mobile-screen-loading" />;
  }
}
