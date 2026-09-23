import { useState, type ReactNode } from 'react';
import type { Screen } from '@/mobile/nav/types';
import { MobileCallScreen } from '@/mobile/screens/MobileCallScreen';
import { CallOverflowSheets } from '@/mobile/call/CallOverflowSheets';
import type { CallOverflowSub } from '@/mobile/call/useCallOverflowItems';
import { useCallStageModel } from '@/components/useCallStageModel';
import { useGuestManagementStore } from '@/stores/guestManagementStore';
import { FriendsScreen } from './FriendsScreen';
import { ProfileScreen } from './ProfileScreen';
import { SettingsScreen } from './SettingsScreen';
import { ServersScreen } from './ServersScreen';
import { ChannelsScreen } from './ChannelsScreen';
import { CreateServerScreen } from './CreateServerScreen';
import { FindServerScreen } from './FindServerScreen';
import { ServerSettingsScreen } from './ServerSettingsScreen';
import { InvitesScreen } from './InvitesScreen';
import { StickersScreen } from './StickersScreen';
import { ChatScreen } from './ChatScreen';
import { ChannelInfoScreen } from './ChannelInfoScreen';
import { SearchScreen } from './SearchScreen';
import { useCallStore } from '@/stores/callStore';

import type { ScreenCtx } from './types';

export type { ScreenCtx } from './types';

function CallScreen({ ctx }: { ctx: ScreenCtx }) {
  const callChannelId = useCallStore((s) => s.callChannelId);
  // Единственный вызов useCallStageModel() для всего экрана звонка (Important
  // I1, task-final-fix-report.md): раньше `MobileCallScreen` звало хук сам, и
  // отдельно `onOpenOverflow`/`onOpenQuality` замораживали копию модели в
  // useState в момент открытия шторки — useCallStageModel() возвращает новый
  // объект на каждый рендер, а этот компонент сам не перерисовывался на
  // изменения состояния звонка, так что замороженная копия не обновлялась
  // (живые метрики CallQualitySheet и список/слайдеры CallVolumeSheet
  // застывали). Теперь модель — одна ссылка, общая для `MobileCallScreen` и
  // `CallOverflowSheets`.
  const model = useCallStageModel();
  const [overflowOpen, setOverflowOpen] = useState(false);
  // D6: the header quality-indicator (onOpenQuality) jumps straight into
  // CallQualitySheet; the «⋯» panel button (onOpenOverflow) opens the
  // generic list. Reset to null on a plain overflow-open so a later generic
  // open doesn't inherit a stale 'quality' from an earlier quality-open.
  const [overflowInitialSub, setOverflowInitialSub] = useState<CallOverflowSub>(null);
  const guestsPresent = useGuestManagementStore((s) => (callChannelId ? (s.channelGuests.get(callChannelId)?.length ?? 0) > 0 : false));
  if (!callChannelId || callChannelId !== ctx.c.currentChannel?.id) return <div className="mobile-screen-loading" />;
  return (
    <>
      <MobileCallScreen
        model={model}
        onBack={ctx.nav.back}
        onOpenChat={() => ctx.nav.push({ kind: 'chat', channelId: callChannelId })}
        onOpenOverflow={() => { setOverflowInitialSub(null); setOverflowOpen(true); }}
        onOpenQuality={() => { setOverflowInitialSub('quality'); setOverflowOpen(true); }}
      />
      <CallOverflowSheets
        open={overflowOpen}
        onClose={() => setOverflowOpen(false)}
        model={model}
        guestsPresent={guestsPresent}
        initialSub={overflowInitialSub}
      />
    </>
  );
}

/** Серверы/каналы/формы — мобильные экраны этапа 2; друзья/профиль/настройки —
 *  мобильные экраны этапа 5; звонок — MobileCallScreen этапа 4. Чат — исключение:
 *  переиспользует десктопную панель ChatArea, а не собственный экран.
 *  Остальные экраны рендерят пустой каркас. */
export function renderScreen(screen: Screen, ctx: ScreenCtx): ReactNode {
  const { c, nav } = ctx;
  switch (screen.kind) {
    case 'servers':
      return <ServersScreen ctx={ctx} />;
    case 'friends':
      return <FriendsScreen />;
    case 'profile':
      return <ProfileScreen ctx={ctx} />;
    case 'settings':
      return <SettingsScreen section={screen.section} onBack={nav.back} />;
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
      return <ChannelInfoScreen channelId={screen.channelId} ctx={ctx} />;
    case 'search': {
      // Чат непосредственно под search — источник группы «Сообщения» (D8).
      const idx = nav.stack.indexOf(screen);
      const below = idx > 0 ? nav.stack[idx - 1] : undefined;
      return <SearchScreen ctx={ctx} channelId={below?.kind === 'chat' ? below.channelId : null} />;
    }
    case 'call':
      return <CallScreen ctx={ctx} />;
    default:
      return <div className="mobile-screen-loading" />;
  }
}
