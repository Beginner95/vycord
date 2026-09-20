import type { ReactNode } from 'react';
import type { Screen } from '@/mobile/nav/types';
import type { AppController } from '@/pages/app/useAppController';
import { ChatArea } from '@/components/ChatArea';
import { CallStage } from '@/components/CallStage';
import { UserList } from '@/components/UserList';
import { HomeView } from '@/components/HomeView';
import { UserPanel } from '@/components/UserPanel';
import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { ServersScreen } from './ServersScreen';
import { ChannelsScreen } from './ChannelsScreen';
import { CreateServerScreen } from './CreateServerScreen';
import { FindServerScreen } from './FindServerScreen';
import { ServerSettingsScreen } from './ServerSettingsScreen';
import { InvitesScreen } from './InvitesScreen';
import { StickersScreen } from './StickersScreen';
import { useCallStore } from '@/stores/callStore';
import { useT } from '@/i18n';

import type { ScreenCtx } from './types';

export type { ScreenCtx } from './types';

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
      onCreateServer={() => nav.push({ kind: 'createServer' })}
      onFindServer={() => nav.push({ kind: 'findServer' })}
      voiceParticipants={c.voiceParticipants}
    />
  );
}

function CallScreen({ ctx }: { ctx: ScreenCtx }) {
  const callChannelId = useCallStore((s) => s.callChannelId);
  if (!callChannelId || callChannelId !== ctx.c.currentChannel?.id) return <div className="mobile-screen-loading" />;
  return <CallStage onMobileBackToChat={ctx.nav.back} />;
}

/** Этап 2: серверы/каналы и формы — мобильные экраны; чат/звонок/друзья —
 *  существующие панели (этапы 3–5). Остальные экраны рендерят пустой каркас. */
export function renderScreen(screen: Screen, ctx: ScreenCtx): ReactNode {
  const { c, nav } = ctx;
  switch (screen.kind) {
    case 'servers':
      return <ServersScreen ctx={ctx} />;
    case 'friends':
      return <HomeView />;
    case 'profile':
      return <ProfileRoot c={c} />;
    case 'channels':
      return <ChannelsScreen serverId={screen.serverId} ctx={ctx} />;
    case 'createServer':
      return <CreateServerScreen onCreate={c.createServer} onBack={nav.back} />;
    case 'findServer':
      return (
        <FindServerScreen
          onJoinServer={c.joinServer}
          onServerJoined={c.serverJoined}
          // «Создать свой» ЗАМЕНЯЕТ экран поиска: после создания serverOpened
          // подменяет стек корнем, и запись «найти» иначе осталась бы в истории.
          onCreateServer={() => nav.replaceStack([...nav.stack.slice(0, -1), { kind: 'createServer' }])}
          onBack={nav.back}
        />
      );
    case 'serverSettings': {
      // Сервер берём из списка, а не из currentServer: экран не должен зависеть
      // от момента, когда reconcile сделает сервер текущим.
      const server = c.servers.find((s) => s.id === screen.serverId);
      return server
        ? <ServerSettingsScreen server={server} onBack={nav.back} />
        : <div className="mobile-screen-loading" />;
    }
    case 'invites':
      return <InvitesScreen serverId={screen.serverId} onBack={nav.back} />;
    case 'stickers':
      return <StickersScreen serverId={screen.serverId} onBack={nav.back} />;
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
