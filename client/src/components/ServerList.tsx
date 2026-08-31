import { useRef, useState } from 'react';
import { Home, Plus, Search } from 'lucide-react';
import type { Server, User } from '@/types';
import { resolveUploadUrl } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { ServerMenu } from '@/components/ServerMenu';
import { can, PERMISSIONS } from '@/utils/permissions';
import { useT } from '@/i18n';
import './ServerList.css';

interface ServerListProps {
  servers: Server[];
  currentServer: Server | null;
  user: User | null;
  onSelectServer: (server: Server) => void;
  onCreateServer: () => void;
  onOpenFindServer: () => void;
  onServerDeleted: (serverId: string) => void;
}

export function ServerList({
  servers,
  currentServer,
  user,
  onSelectServer,
  onCreateServer,
  onOpenFindServer,
  onServerDeleted,
}: ServerListProps) {
  const t = useT();
  // seq — тот же контракт, что в ChannelSidebar: каждое открытие меню
  // монтирует свежий ServerMenu, иначе правый клик во время тоста ошибки попал
  // бы в уже смонтированный экземпляр (меню не открылось бы, а якорь молча
  // переехал бы на другой сервер).
  const [menu, setMenu] = useState<{ x: number; y: number; server: Server; seq: number } | null>(null);
  const menuSeq = useRef(0);

  return (
    <>
      <aside className="server-list">
        <div className="server-list-mobile-header">
          <span>{t('server.listTitle')}</span>
        </div>
        <div
          className={`server-icon server-icon-home ${!currentServer ? 'is-active' : ''}`}
          title={t('server.home')}
        >
          <span className="server-icon-symbol"><Home size={21} strokeWidth={1.8} /></span>
          <span className="server-icon-name">{t('server.home')}</span>
        </div>
        <div className="server-divider" />
        {servers.map((server) => (
          <div
            key={server.id}
            className={`server-icon ${currentServer?.id === server.id ? 'is-active' : ''}`}
            onClick={() => onSelectServer(server)}
            onContextMenu={(e) => {
              const perms = useServerStore.getState().permissions.get(server.id);
              const canManage = can(perms, PERMISSIONS.MANAGE_SERVER) || server.owner_id === user?.id;
              const canInvite = can(perms, PERMISSIONS.CREATE_INVITE);
              if (!canManage && !canInvite) return;
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, server, seq: ++menuSeq.current });
            }}
            title={server.name}
          >
            {server.icon_url ? (
              <img src={resolveUploadUrl(server.icon_url)} alt={server.name} />
            ) : (
              <span className="server-icon-symbol">{server.name.charAt(0).toUpperCase()}</span>
            )}
            <span className="server-icon-name">{server.name}</span>
          </div>
        ))}
        <div className="rail-bottom">
          <div className="server-icon server-icon-add" onClick={onCreateServer} title={t('server.create')}>
            <span className="server-icon-symbol"><Plus size={20} strokeWidth={1.8} /></span>
            <span className="server-icon-name">{t('server.create')}</span>
          </div>
          <div className="server-icon server-icon-search" onClick={onOpenFindServer} title={t('server.explore')}>
            <span className="server-icon-symbol"><Search size={18} strokeWidth={1.8} /></span>
            <span className="server-icon-name">{t('server.explore')}</span>
          </div>
        </div>
      </aside>

      {menu && (
        <ServerMenu
          key={`${menu.server.id}:${menu.seq}`}
          server={menu.server}
          user={user}
          anchor={menu}
          onClose={() => setMenu(null)}
          onDeleted={onServerDeleted}
        />
      )}
    </>
  );
}
