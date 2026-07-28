import { useState } from 'react';
import type { Server, User } from '@/types';
import { apiService } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { ContextMenu } from '@/components/ContextMenu';
import { EditServerModal } from '@/components/EditServerModal';
import './ServerList.css';

interface ServerListProps {
  servers: Server[];
  currentServer: Server | null;
  user: User | null;
  onSelectServer: (server: Server) => void;
  onCreateServer: () => void;
  onJoinServer: (server: Server) => void;
  onServerDeleted: (serverId: string) => void;
}

export function ServerList({
  servers,
  currentServer,
  user,
  onSelectServer,
  onCreateServer,
  onJoinServer,
  onServerDeleted,
}: ServerListProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Server[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; server: Server } | null>(null);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const editingServer = servers.find((s) => s.id === editingServerId) ?? null;

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    try {
      const results = await apiService.searchServers(searchQuery) as Server[];
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleDeleteServer = async (server: Server) => {
    if (!window.confirm(`Удалить сервер «${server.name}»? Это действие необратимо.`)) return;
    try {
      await apiService.deleteServer(server.id);
      useServerStore.getState().removeServer(server.id);
      onServerDeleted(server.id);
    } catch (err) {
      console.error('Failed to delete server:', err);
      alert(err instanceof Error ? err.message : 'Не удалось удалить сервер');
    }
  };

  return (
    <>
      <aside className="server-list">
        <div className="server-list-mobile-header">
          <span>Servers</span>
        </div>
        <div
          className={`server-icon home ${!currentServer ? 'active' : ''}`}
          title="Home"
        >
          <span className="server-icon-symbol">🏠</span>
          <span className="server-icon-name">Home</span>
        </div>
        <div className="server-divider" />
        {servers.map((server) => (
          <div
            key={server.id}
            className={`server-icon ${currentServer?.id === server.id ? 'active' : ''}`}
            onClick={() => onSelectServer(server)}
            onContextMenu={(e) => {
              if (server.owner_id !== user?.id) return;
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, server });
            }}
            title={server.name}
          >
            {server.icon_url ? (
              <img src={server.icon_url} alt={server.name} />
            ) : (
              <span className="server-icon-symbol">{server.name.charAt(0).toUpperCase()}</span>
            )}
            <span className="server-icon-name">{server.name}</span>
          </div>
        ))}
        <div className="server-icon add" onClick={onCreateServer} title="Create a Server">
          <span className="server-icon-symbol">+</span>
          <span className="server-icon-name">Create Server</span>
        </div>
        <div className="server-icon search" onClick={() => setSearchOpen(true)} title="Explore Servers">
          <span className="server-icon-symbol">🔍</span>
          <span className="server-icon-name">Explore Servers</span>
        </div>
      </aside>

      {searchOpen && (
        <div className="modal-overlay" onClick={() => setSearchOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Explore Servers</h2>
            <div className="search-bar">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search servers..."
                autoFocus
              />
              <button onClick={handleSearch} disabled={searchLoading}>
                {searchLoading ? 'Searching...' : 'Search'}
              </button>
            </div>

            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((s) => (
                  <div key={s.id} className="search-result-item">
                    <span>{s.name}</span>
                    <button onClick={() => { onJoinServer(s); setSearchOpen(false); }}>
                      Join
                    </button>
                  </div>
                ))}
              </div>
            )}

            {searchQuery && searchResults.length === 0 && !searchLoading && (
              <p className="search-empty">No servers found</p>
            )}
          </div>
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Редактировать', onClick: () => setEditingServerId(menu.server.id) },
            { label: 'Удалить сервер', danger: true, onClick: () => handleDeleteServer(menu.server) },
          ]}
        />
      )}

      {editingServer && (
        <EditServerModal server={editingServer} onClose={() => setEditingServerId(null)} />
      )}
    </>
  );
}
