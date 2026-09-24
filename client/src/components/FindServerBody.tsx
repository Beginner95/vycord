import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { Server, InvitePreview } from '@/types';
import { apiService, apiErrorText } from '@/services/api';
import { Avatar } from '@/components/Avatar';
import { useT } from '@/i18n';
import './FindServerModal.css';

interface FindServerBodyProps {
  /** Модалка: `open`; мобильный экран: всегда true. Когда false — состояние
   *  сбрасывается и поиск не идёт. */
  active: boolean;
  onJoinServer: (server: Server) => void;
  onServerJoined: (server: Server) => void;
  /** Модалка: onClose; экран: nav.back(). */
  onDone: () => void;
  onCreateServer: () => void;
}

/** Тело «Найти сервер»: поле, результаты, ошибка, «ничего не найдено», подвал.
 *  Общее для десктопной модалки (FindServerModal) и мобильного экрана
 *  (FindServerScreen, VYC-95). Оболочка — заголовок, фокус-ловушка, оверлей —
 *  остаётся у хоста. */
export function FindServerBody({ active, onJoinServer, onServerJoined, onDone, onCreateServer }: FindServerBodyProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Server[]>([]);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) { setQuery(''); setResults([]); setPreview(null); setSearched(false); }
    // joinError сбрасывается на ОБЕИХ границах, а не только на закрытии:
    // отклонённый joinViaInvite может разрешиться уже после Escape и записать
    // ошибку в закрытый, но ещё смонтированный компонент — тогда при следующем
    // открытии .modal-error висел бы над пустым полем, описывая вход, от
    // которого пользователь уже отказался.
    setJoinError(null);
  }, [active]);

  useEffect(() => {
    const q = query.trim();
    if (!active || !q) { setResults([]); setPreview(null); setSearched(false); return; }
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
  }, [active, query]);

  const handleJoinByInvite = async () => {
    if (!preview) return;
    setBusy(true);
    setJoinError(null);
    try {
      const server = await apiService.joinViaInvite(query.trim());
      onServerJoined(server);
      onDone();
    } catch (err) {
      setJoinError(apiErrorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const hasRows = preview !== null || results.length > 0;
  return (
    <>
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
              <button type="button" className="btn btn-primary" onClick={() => { onJoinServer(s); onDone(); }}>
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
        <button type="button" className="btn btn-secondary" onClick={() => { onDone(); onCreateServer(); }}>
          {t('server.findServer.createOwn')}
        </button>
      </div>
    </>
  );
}
