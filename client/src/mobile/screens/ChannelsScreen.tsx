import { useMemo, useState } from 'react';
import { Hash, MoreHorizontal } from 'lucide-react';
import type { Channel } from '@/types';
import { useT, useTp } from '@/i18n';
import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { MobileListRow } from '@/mobile/components/MobileListRow';
import { ActivityMeta, useActivitySubtitle } from '@/mobile/components/ActivityMeta';
import { ServerMenuSheet } from '@/mobile/menus/ServerMenuSheet';
import { ChannelMenuSheet } from '@/mobile/menus/ChannelMenuSheet';
import { useLongPress } from '@/mobile/gestures/useLongPress';
import { useChannelActivity } from '@/mobile/activity';
import { voiceLineParts } from '@/mobile/voiceLine';
import type { ScreenCtx } from './types';
import './ChannelsScreen.css';

/** Экран каналов сервера (спека §5.3). */
export function ChannelsScreen({ serverId, ctx }: { serverId: string; ctx: ScreenCtx }) {
  const { c, nav } = ctx;
  const t = useT();
  const tp = useTp();
  const [serverMenu, setServerMenu] = useState(false);
  const [channelMenu, setChannelMenu] = useState<Channel | null>(null);

  const nameOf = useMemo(() => {
    const byId = new Map(c.members.map((m) => [m.user_id, m.username] as const));
    return (id: string) => byId.get(id) ?? id.slice(0, 8);
  }, [c.members]);

  // Стек может опережать сторы (восстановление записи, переключение сервера):
  // пока стор не догнал, экран ждёт, как и на этапе 1.
  if (c.currentServer?.id !== serverId) return <div className="mobile-screen-loading" />;
  const server = c.currentServer;
  // handleSelectServer ставит currentServer сразу, а channels заменяет после
  // загрузки: сразу после переключения в сторе ещё каналы ПРЕДЫДУЩЕГО сервера.
  const channels = c.channels.filter((ch) => ch.server_id === serverId);
  const stale = channels.length === 0 && c.channels.length > 0;

  return (
    <div className="channels-screen">
      <ScreenHeader
        title={server.name}
        // handleSelectServer сбрасывает members в [] и догружает после каналов —
        // «0 участников» на каждом переключении было бы ложью.
        subtitle={c.members.length > 0 ? tp('mobile.membersCount', c.members.length) : undefined}
        onBack={nav.back}
        actions={
          <button type="button" className="screen-header-btn" aria-label={t('mobile.serverActions')} onClick={() => setServerMenu(true)}>
            <MoreHorizontal size={24} strokeWidth={1.8} />
          </button>
        }
      />
      <div className="channels-list">
        {stale ? (
          <div className="mobile-screen-loading" />
        ) : channels.length === 0 ? (
          <div className="mobile-empty">
            <p className="mobile-empty-body">{t('mobile.channelsEmpty')}</p>
          </div>
        ) : (
          channels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              voiceIds={c.voiceParticipants.get(channel.id) ?? []}
              nameOf={nameOf}
              onOpen={() => nav.push({ kind: 'chat', channelId: channel.id })}
              onMenu={() => setChannelMenu(channel)}
            />
          ))
        )}
      </div>

      {/* D8: сущность остаётся смонтированной, пока меню не сообщит onClose. */}
      <ServerMenuSheet
        server={server}
        user={c.user}
        open={serverMenu}
        onClose={() => setServerMenu(false)}
        onCreateChannel={() => c.ui.setCreateChannelOpen(true)}
        onInvites={() => nav.push({ kind: 'invites', serverId })}
        onSettings={() => nav.push({ kind: 'serverSettings', serverId })}
        onStickers={() => nav.push({ kind: 'stickers', serverId })}
        onDeleted={(id) => { c.serverRemoved(id); nav.back(); }}
      />
      <ChannelMenuSheet
        channel={channelMenu}
        serverId={serverId}
        channelCount={channels.length}
        open={channelMenu !== null}
        onClose={() => setChannelMenu(null)}
        onDeleted={(id) => c.channelRemoved(id)}
      />
    </div>
  );
}

function ChannelRow({
  channel, voiceIds, nameOf, onOpen, onMenu,
}: {
  channel: Channel;
  voiceIds: string[];
  nameOf: (id: string) => string;
  onOpen: () => void;
  onMenu: () => void;
}) {
  const t = useT();
  const longPress = useLongPress(onMenu);
  const activity = useChannelActivity(channel.id);
  const activitySub = useActivitySubtitle(activity);

  const parts = voiceLineParts(voiceIds, nameOf);
  const voiceText = parts
    ? t('mobile.voiceLine', {
        names: parts.extra > 0
          ? t('mobile.voiceMore', { names: parts.names.join(', '), count: String(parts.extra) })
          : parts.names.join(', '),
      })
    : null;

  return (
    <MobileListRow
      avatar={<span className="channel-avatar"><Hash size={20} strokeWidth={1.8} /></span>}
      title={channel.name}
      subtitle={voiceText ?? activitySub ?? undefined}
      meta={<ActivityMeta activity={activity} />}
      onClick={onOpen}
      longPress={longPress}
    />
  );
}
