import { useMemo, useState } from 'react';
import { Lock, Plus, Search } from 'lucide-react';
import type { Server } from '@/types';
import { resolveUploadUrl } from '@/services/api';
import { useT } from '@/i18n';
import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { MobileListRow } from '@/mobile/components/MobileListRow';
import { ActivityMeta, useActivitySubtitle } from '@/mobile/components/ActivityMeta';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';
import { ServerMenuSheet } from '@/mobile/menus/ServerMenuSheet';
import { useLongPress } from '@/mobile/gestures/useLongPress';
import { useServerActivity } from '@/mobile/activity';
import { voiceLineParts } from '@/mobile/voiceLine';
import type { ScreenCtx } from './types';
import './ServersScreen.css';

/** Корень вкладки «Серверы» (спека §5.2). */
export function ServersScreen({ ctx }: { ctx: ScreenCtx }) {
  const { c, nav } = ctx;
  const t = useT();
  const [addOpen, setAddOpen] = useState(false);
  const [menuServer, setMenuServer] = useState<Server | null>(null);

  // Голос известен только про ТЕКУЩИЙ сервер: загружены каналы лишь его одного.
  const voiceIds = useMemo(() => {
    const ids: string[] = [];
    // handleSelectServer ставит currentServer раньше, чем приходят его каналы (а
    // при сбое запроса они так и остаются прежними) — чужие каналы не считаем.
    for (const ch of c.channels) {
      if (ch.server_id !== c.currentServer?.id) continue;
      ids.push(...(c.voiceParticipants.get(ch.id) ?? []));
    }
    return ids;
  }, [c.channels, c.currentServer?.id, c.voiceParticipants]);

  const nameOf = useMemo(() => {
    const byId = new Map(c.members.map((m) => [m.user_id, m.username] as const));
    return (id: string) => byId.get(id) ?? id.slice(0, 8);
  }, [c.members]);

  return (
    <div className="servers-screen">
      <ScreenHeader
        title={t('mobile.tabServers')}
        actions={
          <>
            <button type="button" className="screen-header-btn" aria-label={t('mobile.search')} onClick={() => nav.push({ kind: 'search' })}>
              <Search size={24} strokeWidth={1.8} />
            </button>
            <button type="button" className="screen-header-btn" aria-label={t('mobile.addServer')} onClick={() => setAddOpen(true)}>
              <Plus size={24} strokeWidth={1.8} />
            </button>
          </>
        }
      />
      <div className="servers-list">
        {c.servers.length === 0 ? (
          <div className="mobile-empty">
            <h2 className="mobile-empty-title">{t('chat.noServersTitle')}</h2>
            <p className="mobile-empty-body">{t('mobile.noServersBody')}</p>
            <div className="mobile-empty-actions">
              <button type="button" className="btn btn-primary" onClick={() => nav.push({ kind: 'createServer' })}>
                {t('server.create')}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => nav.push({ kind: 'findServer' })}>
                {t('chat.haveCode')}
              </button>
            </div>
          </div>
        ) : (
          c.servers.map((server) => (
            <ServerRow
              key={server.id}
              server={server}
              voiceIds={server.id === c.currentServer?.id ? voiceIds : []}
              nameOf={nameOf}
              onOpen={() => nav.push({ kind: 'channels', serverId: server.id })}
              onMenu={() => setMenuServer(server)}
            />
          ))
        )}
      </div>

      <ActionSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={t('mobile.addServer')}
        items={[
          { label: t('mobile.createServerAction'), onClick: () => nav.push({ kind: 'createServer' }) },
          { label: t('mobile.findServerAction'), onClick: () => nav.push({ kind: 'findServer' }) },
        ]}
      />
      {/* D8: сервер остаётся смонтированным, пока меню не сообщит onClose. */}
      <ServerMenuSheet
        server={menuServer}
        user={c.user}
        open={menuServer !== null}
        onClose={() => setMenuServer(null)}
        onInvites={menuServer ? () => nav.push({ kind: 'invites', serverId: menuServer.id }) : undefined}
        onSettings={menuServer ? () => nav.push({ kind: 'serverSettings', serverId: menuServer.id }) : undefined}
        onStickers={menuServer ? () => nav.push({ kind: 'stickers', serverId: menuServer.id }) : undefined}
        onDeleted={(id) => c.serverRemoved(id)}
      />
    </div>
  );
}

function ServerRow({
  server, voiceIds, nameOf, onOpen, onMenu,
}: {
  server: Server;
  voiceIds: string[];
  nameOf: (id: string) => string;
  onOpen: () => void;
  onMenu: () => void;
}) {
  const t = useT();
  const longPress = useLongPress(onMenu);
  const activity = useServerActivity(server.id);
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
      avatar={
        server.icon_url
          ? <img className="server-avatar" src={resolveUploadUrl(server.icon_url)} alt="" />
          : <span className="server-avatar">{server.name.charAt(0).toUpperCase()}</span>
      }
      title={server.name}
      titleIcon={server.is_private
        ? <Lock size={14} strokeWidth={1.8} role="img" aria-label={t('mobile.privateServer')} />
        : undefined}
      subtitle={voiceText ?? activitySub ?? undefined}
      meta={<ActivityMeta activity={activity} />}
      onClick={onOpen}
      longPress={longPress}
    />
  );
}
