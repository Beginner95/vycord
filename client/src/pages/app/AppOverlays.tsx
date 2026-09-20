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
  /** Выбор канала в палитре / вход по баннеру — оболочке нужно ещё и навигировать. */
  onPaletteSelectChannel: (channel: Channel) => void;
  onPaletteJoinVoice: (channel: Channel) => void;
  onPaletteShowChat: () => void;
}

/** Общие для обеих оболочек оверлеи, в ТОМ ЖЕ порядке DOM, что был в AppPage
 *  (FindServer → Settings → CreateChannel → CreateServer → CallNotif → Palette). */
export function AppOverlays({ c, onPaletteSelectChannel, onPaletteJoinVoice, onPaletteShowChat }: AppOverlaysProps) {
  const openCreateServer = () => c.ui.setCreateServerOpen(true);
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
      <CommandPalette
        onSelectChannel={onPaletteSelectChannel}
        onOpenSettings={() => c.ui.setSettingsOpen(true)}
        onCreateChannel={() => c.ui.setCreateChannelOpen(true)}
        onCreateServer={openCreateServer}
        onFindServer={() => c.ui.setFindServerOpen(true)}
        onJoinVoice={onPaletteJoinVoice}
        onShowChat={onPaletteShowChat}
      />
    </>
  );
}
