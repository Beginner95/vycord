import { useState } from 'react';
import type { Server } from '@/types';
import { apiService } from '@/services/api';
import './ServerList.css';

interface ServerListProps {
  servers: Server[];
  currentServer: Server | null;
  onSelectServer: (server: Server) => void;
  onCreateServer: () => void;
  onJoinServer: (server: Server) => void;
}

export function ServerList({ servers, currentServer, onSelectServer, onCreateServer, onJoinServer }: ServerListProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Server[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

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

  return (
    <>
      <aside className="server-list">
        <div
          className={`server-icon home ${!currentServer ? 'active' : ''}`}
          title="Home"
        >
          🏠
        </div>
        <div className="server-divider" />
        {servers.map((server) => (
          <div
            key={server.id}
            className={`server-icon ${currentServer?.id === server.id ? 'active' : ''}`}
            onClick={() => onSelectServer(server)}
            title={server.name}
          >
            {server.icon_url ? (
              <img src={server.icon_url} alt={server.name} />
            ) : (
              server.name.charAt(0).toUpperCase()
            )}
          </div>
        ))}
        <div className="server-icon add" onClick={onCreateServer} title="Create a Server">
          +
        </div>
        <div className="server-icon search" onClick={() => setSearchOpen(true)} title="Explore Servers">
          🔍
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
    </>
  );
}
