import { useEffect, useRef, useState } from 'react';
import { X, Search } from 'lucide-react';
import type { Server, InvitePreview } from '@/types';
import { apiService, apiErrorText } from '@/services/api';
import { Avatar } from '@/components/Avatar';
import { useModalFocus } from '@/hooks/useModalFocus';
import { useT } from '@/i18n';
import './FindServerModal.css';

interface FindServerModalProps {
  open: boolean;
  onClose: () => void;
  onJoinServer: (server: Server) => void;
  onServerJoined: (server: Server) => void;
  onCreateServer: () => void;
}

export function FindServerModal({ open, onClose, onJoinServer, onServerJoined, onCreateServer }: FindServerModalProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Server[]>([]);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(open, ref, onClose);

  useEffect(() => {
    if (!open) { setQuery(''); setResults([]); setPreview(null); setSearched(false); }
    // joinError сбрасывается на ОБЕИХ границах, а не только на закрытии:
    // отклонённый joinViaInvite может разрешиться уже после Escape и записать
    // ошибку в закрытый, но ещё смонтированный компонент — тогда при следующем
    // открытии .modal-error висел бы над пустым полем, описывая вход, от
    // которого пользователь уже отказался.
    setJoinError(null);
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!open || !q) { setResults([]); setPreview(null); setSearched(false); return; }
    // Stale-response guard, тот же контракт, что у handleSelectChannel в
    // AppPage.tsx: clearTimeout отменяет только НЕ сработавший таймер. Пауза
    // длиннее 300 мс между нажатиями оставляет запрос A в полёте, и он может
    // разрешиться после запроса B — тогда в списке оказались бы результаты
    // чужого запроса. Флаг закрывает именно это окно.
    let cancelled = false;
    const timer = setTimeout(() => {
      // Одно поле — оба запроса параллельно (spec §2 «merged into one field»).
      // previewInvite на произвольной строке отвечает 404 — это ожидаемо и глотается.
      void Promise.allSettled([apiService.searchServers(q), apiService.previewInvite(q)]).then(
        ([search, invite]) => {
          if (cancelled) return;
          setResults(search.status === 'fulfilled' ? (search.value as Server[]) : []);
          setPreview(invite.status === 'fulfilled' ? invite.value : null);
          setSearched(true);
        },
      );
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, query]);

  const handleJoinByInvite = async () => {
    if (!preview) return;
    setBusy(true);
    setJoinError(null);
    try {
      const server = await apiService.joinViaInvite(query.trim());
      onServerJoined(server);
      onClose();
    } catch (err) {
      setJoinError(apiErrorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  const hasRows = preview !== null || results.length > 0;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={ref} className="modal find-server-modal" role="dialog" aria-modal="true" aria-label={t('server.findServer.title')} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{t('server.findServer.title')}</div>
            <p className="modal-sub">{t('server.findServer.description')}</p>
          </div>
          <button type="button" className="modal-close-btn" aria-label={t('common.close')} onClick={onClose}>
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
        <input
          className="input"
          data-autofocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('server.findServer.placeholder')}
        />
        {hasRows && <div className="find-server-results-label">{t('server.findServer.results')}</div>}
        {hasRows && (
          <div className="find-server-list">
            {preview && (
              <div className="find-server-row is-invite">
                <Avatar username={preview.server_name} url={preview.icon_url} className="find-server-avatar" />
                <div>
                  <div className="find-server-name">{preview.server_name}</div>
                  <div className="find-server-meta">
                    {t('server.findServer.byInvite')} · {t('server.joinByCode.memberCount', { count: String(preview.member_count) })}
                  </div>
                </div>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={handleJoinByInvite}>
                  {t('server.findServer.joinAction')}
                </button>
              </div>
            )}
            {results.map((s) => (
              <div key={s.id} className="find-server-row">
                <Avatar username={s.name} url={s.icon_url} className="find-server-avatar" />
                <div className="find-server-name">{s.name}</div>
                <button type="button" className="btn btn-primary" onClick={() => { onJoinServer(s); onClose(); }}>
                  {t('server.findServer.joinAction')}
                </button>
              </div>
            ))}
          </div>
        )}
        {joinError && <p className="modal-error">{joinError}</p>}
        {searched && !hasRows && (
          <p className="find-server-empty">
            <Search size={16} strokeWidth={1.8} /> {t('server.findServer.noResults', { query: query.trim() })}
          </p>
        )}
        <div className="find-server-footer">
          <span className="find-server-footer-text">{t('server.findServer.footerQuestion')}</span>
          <button type="button" className="btn btn-secondary" onClick={() => { onClose(); onCreateServer(); }}>
            {t('server.findServer.createOwn')}
          </button>
        </div>
      </div>
    </div>
  );
}
