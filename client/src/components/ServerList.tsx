import { useState } from 'react';
import type { Server, User, InvitePreview } from '@/types';
import { apiService, apiErrorText, resolveUploadUrl } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { ContextMenu } from '@/components/ContextMenu';
import { EditServerModal } from '@/components/EditServerModal';
import { ManageInvitesModal } from '@/components/ManageInvitesModal';
import { can, PERMISSIONS } from '@/utils/permissions';
import { useT } from '@/i18n';
import './ServerList.css';

interface ServerListProps {
  servers: Server[];
  currentServer: Server | null;
  user: User | null;
  onSelectServer: (server: Server) => void;
  onCreateServer: () => void;
  onJoinServer: (server: Server) => void;
  onServerJoined: (server: Server) => void;
  onServerDeleted: (serverId: string) => void;
}

export function ServerList({
  servers,
  currentServer,
  user,
  onSelectServer,
  onCreateServer,
  onJoinServer,
  onServerJoined,
  onServerDeleted,
}: ServerListProps) {
  const t = useT();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Server[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; server: Server } | null>(null);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [invitingServerId, setInvitingServerId] = useState<string | null>(null);
  const editingServer = servers.find((s) => s.id === editingServerId) ?? null;

  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [inviteError, setInviteError] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);

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

  const handlePreviewInvite = async () => {
    const code = inviteCodeInput.trim();
    if (!code) return;
    setInviteBusy(true);
    setInviteError('');
    setInvitePreview(null);
    try {
      const preview = await apiService.previewInvite(code);
      setInvitePreview(preview);
    } catch (err) {
      setInviteError(apiErrorText(err, t));
    } finally {
      setInviteBusy(false);
    }
  };

  const handleJoinByInvite = async () => {
    const code = inviteCodeInput.trim();
    if (!code) return;
    setInviteBusy(true);
    setInviteError('');
    try {
      const server = await apiService.joinViaInvite(code);
      setSearchOpen(false);
      setInviteCodeInput('');
      setInvitePreview(null);
      onServerJoined(server);
    } catch (err) {
      setInviteError(apiErrorText(err, t));
    } finally {
      setInviteBusy(false);
    }
  };

  const handleDeleteServer = async (server: Server) => {
    if (!window.confirm(t('server.deleteConfirm', { name: server.name }))) return;
    try {
      await apiService.deleteServer(server.id);
      useServerStore.getState().removeServer(server.id);
      onServerDeleted(server.id);
    } catch (err) {
      console.error('Failed to delete server:', err);
      alert(apiErrorText(err, t));
    }
  };

  return (
    <>
      <aside className="server-list">
        <div className="server-list-mobile-header">
          <span>{t('server.listTitle')}</span>
        </div>
        <div
          className={`server-icon home ${!currentServer ? 'active' : ''}`}
          title={t('server.home')}
        >
          <span className="server-icon-symbol">🏠</span>
          <span className="server-icon-name">{t('server.home')}</span>
        </div>
        <div className="server-divider" />
        {servers.map((server) => (
          <div
            key={server.id}
            className={`server-icon ${currentServer?.id === server.id ? 'active' : ''}`}
            onClick={() => onSelectServer(server)}
            onContextMenu={(e) => {
              const perms = useServerStore.getState().permissions.get(server.id);
              const canManage = can(perms, PERMISSIONS.MANAGE_SERVER) || server.owner_id === user?.id;
              const canInvite = can(perms, PERMISSIONS.CREATE_INVITE);
              if (!canManage && !canInvite) return;
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, server });
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
        <div className="server-icon add" onClick={onCreateServer} title={t('server.create')}>
          <span className="server-icon-symbol">+</span>
          <span className="server-icon-name">{t('server.create')}</span>
        </div>
        <div className="server-icon search" onClick={() => setSearchOpen(true)} title={t('server.explore')}>
          <span className="server-icon-symbol">🔍</span>
          <span className="server-icon-name">{t('server.explore')}</span>
        </div>
      </aside>

      {searchOpen && (
        <div className="modal-overlay">
          <div className="modal explore-server-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('server.explore')}</h2>
            <button
              type="button"
              className="explore-server-close"
              title={t('common.close')}
              aria-label={t('common.close')}
              onClick={() => setSearchOpen(false)}
            >
              ✕
            </button>
            <div className="search-bar">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder={t('server.searchPlaceholder')}
                autoFocus
              />
              <button onClick={handleSearch} disabled={searchLoading}>
                {searchLoading ? t('server.searching') : t('server.search')}
              </button>
            </div>

            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((s) => (
                  <div key={s.id} className="search-result-item">
                    <span>{s.name}</span>
                    <button onClick={() => { onJoinServer(s); setSearchOpen(false); }}>
                      {t('server.join')}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {searchQuery && searchResults.length === 0 && !searchLoading && (
              <p className="search-empty">{t('server.noneFound')}</p>
            )}

            <div className="explore-server-divider">
              <span>{t('server.orSeparator')}</span>
            </div>

            <div className="form-group">
              <label htmlFor="invite-code-input">{t('server.joinByCode.label')}</label>
              <div className="search-bar">
                <input
                  id="invite-code-input"
                  type="text"
                  value={inviteCodeInput}
                  onChange={(e) => { setInviteCodeInput(e.target.value); setInvitePreview(null); setInviteError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handlePreviewInvite()}
                  placeholder={t('server.joinByCode.placeholder')}
                />
                <button onClick={handlePreviewInvite} disabled={inviteBusy || !inviteCodeInput.trim()}>
                  {t('server.joinByCode.preview')}
                </button>
              </div>
            </div>

            {inviteError && <p className="modal-error">{inviteError}</p>}

            {invitePreview && (
              <div className="search-result-item">
                <span>
                  {invitePreview.server_name} · {t('server.joinByCode.memberCount', { count: String(invitePreview.member_count) })}
                </span>
                <button onClick={handleJoinByInvite} disabled={inviteBusy}>
                  {t('server.join')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {menu && (() => {
        const menuPerms = useServerStore.getState().permissions.get(menu.server.id);
        const canManageMenu = can(menuPerms, PERMISSIONS.MANAGE_SERVER) || menu.server.owner_id === user?.id;
        const canInviteMenu = can(menuPerms, PERMISSIONS.CREATE_INVITE);
        return (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            items={[
              ...(canInviteMenu
                ? [{ label: t('server.inviteMenu'), onClick: () => setInvitingServerId(menu.server.id) }]
                : []),
              ...(canManageMenu
                ? [{ label: t('server.editMenu'), onClick: () => setEditingServerId(menu.server.id) }]
                : []),
              // Удаление сервера — привилегия владения и на бэкенде (DeleteServer
              // проверяет только owner_id), роль с MANAGE_SERVER снести сервер не может.
              ...(menu.server.owner_id === user?.id
                ? [{ label: t('server.deleteMenu'), danger: true, onClick: () => handleDeleteServer(menu.server) }]
                : []),
            ]}
          />
        );
      })()}

      {editingServer && (
        <EditServerModal server={editingServer} onClose={() => setEditingServerId(null)} />
      )}

      {invitingServerId && (
        <ManageInvitesModal serverId={invitingServerId} onClose={() => setInvitingServerId(null)} />
      )}
    </>
  );
}
