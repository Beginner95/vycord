import type { Channel } from '@/types';
import type { AppController } from './useAppController';
import { FindServerModal } from '@/components/FindServerModal';
import { Settings } from '@/components/Settings';
import { CreateChannelModal } from '@/components/CreateChannelModal';
import { CallNotifBanner } from '@/components/CallNotifBanner';
import { CommandPalette } from '@/components/CommandPalette';
import { CreateServerModal } from './CreateServerModal';

interface AppOverlaysProps {
  c: AppController;
  /** Переопределения открытия форм (мобильная оболочка ведёт на экраны, а не в модалки). */
  onOpenCreateServer?: () => void;
  onOpenFindServer?: () => void;
  /** Выбор канала в палитре / вход по баннеру — оболочке нужно ещё и навигировать. */
  onPaletteSelectChannel: (channel: Channel) => void;
  onPaletteJoinVoice: (channel: Channel) => void;
  onPaletteShowChat: () => void;
  /** Мобильная оболочка заменяет оверлей палитры экраном `search` (спека D8). */
  showPalette?: boolean;
}

/** Общие для обеих оболочек оверлеи, в ТОМ ЖЕ порядке DOM, что был в AppPage
 *  (FindServer → Settings → CreateChannel → CreateServer → CallNotif → Palette). */
export function AppOverlays({
  c, onOpenCreateServer, onOpenFindServer, onPaletteSelectChannel, onPaletteJoinVoice, onPaletteShowChat,
  showPalette = true,
}: AppOverlaysProps) {
  const openCreateServer = onOpenCreateServer ?? (() => c.ui.setCreateServerOpen(true));
  const openFindServer = onOpenFindServer ?? (() => c.ui.setFindServerOpen(true));
  return (
    <>
      <FindServerModal
        open={c.ui.findServerOpen}
        onClose={() => c.ui.setFindServerOpen(false)}
        onJoinServer={c.joinServer}
        onServerJoined={c.serverJoined}
        onCreateServer={openCreateServer}
      />
      <Settings isOpen={c.ui.settingsOpen} onClose={() => c.ui.setSettingsOpen(false)} onLogout={c.logout} />
      {c.ui.createChannelOpen && c.currentServer && (
        <CreateChannelModal serverId={c.currentServer.id} onClose={() => c.ui.setCreateChannelOpen(false)} />
      )}
      {c.ui.createServerOpen && (
        <CreateServerModal onClose={() => c.ui.setCreateServerOpen(false)} onCreate={c.createServer} />
      )}
      {c.callNotif && (
        <CallNotifBanner
          callerName={c.callNotif.callerName}
          channelName={c.callNotif.channelName}
          onJoin={c.joinCallNotif}
          onDismiss={c.dismissCallNotif}
        />
      )}
      {showPalette && (
        <CommandPalette
          onSelectChannel={onPaletteSelectChannel}
          onOpenSettings={() => c.ui.setSettingsOpen(true)}
          onCreateChannel={() => c.ui.setCreateChannelOpen(true)}
          onCreateServer={openCreateServer}
          onFindServer={openFindServer}
          onJoinVoice={onPaletteJoinVoice}
          onShowChat={onPaletteShowChat}
        />
      )}
    </>
  );
}
