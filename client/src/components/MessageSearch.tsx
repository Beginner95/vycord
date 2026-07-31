import { useState, useEffect, useRef, type ReactNode } from 'react';
import { apiService, apiErrorText } from '@/services/api';
import type { Channel, MessageWithAuthor, MessageSearchResponse } from '@/types';
import { useT } from '@/i18n';
import './MessageSearch.css';

const MIN_QUERY_LEN = 2;
const PAGE_SIZE = 25;
const DEBOUNCE_MS = 300;

interface MessageSearchProps {
  channel: Channel;
  onJumpToMessage: (messageId: string) => void;
  onClose: () => void;
}

function formatResultDate(dateStr: string) {
  const date = new Date(dateStr);
  const day = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time}`;
}

// Обрезает длинный текст окном вокруг первого совпадения.
function snippetAround(content: string, query: string, radius = 80): string {
  if (content.length <= radius * 2) return content;
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return `${content.slice(0, radius * 2)}…`;
  const start = Math.max(0, idx - radius);
  const end = Math.min(content.length, idx + query.length + radius);
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}

function highlightMatches(text: string, query: string): ReactNode[] {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: ReactNode[] = [];
  let pos = 0;
  let key = 0;
  for (;;) {
    const idx = lower.indexOf(q, pos);
    if (idx === -1) break;
    if (idx > pos) parts.push(text.slice(pos, idx));
    parts.push(<mark key={key++}>{text.slice(idx, idx + q.length)}</mark>);
    pos = idx + q.length;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return parts;
}

export function MessageSearch({ channel, onJumpToMessage, onClose }: MessageSearchProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MessageWithAuthor[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = query.trim();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (trimmed.length < MIN_QUERY_LEN) {
      setResults([]);
      setTotal(0);
      setSearched(false);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = (await apiService.searchMessages(channel.id, trimmed, PAGE_SIZE, 0)) as MessageSearchResponse;
        if (cancelled) return;
        setResults(data.results);
        setTotal(data.total);
        setError(null);
        setSearched(true);
      } catch (err) {
        if (cancelled) return;
        setError(apiErrorText(err, t));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, channel.id]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const data = (await apiService.searchMessages(channel.id, trimmed, PAGE_SIZE, results.length)) as MessageSearchResponse;
      setResults((prev) => [...prev, ...data.results]);
      setTotal(data.total);
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <aside className="message-search" aria-label="Поиск сообщений">
      <div className="message-search-header">
        <div className="message-search-input-wrap">
          <svg className="message-search-input-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder={`Поиск в #${channel.name}`}
            maxLength={100}
          />
          {query && (
            <button type="button" className="message-search-clear" aria-label="Очистить" onClick={() => setQuery('')}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
        </div>
        <button type="button" className="message-search-close" aria-label="Закрыть поиск" onClick={onClose}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      {searched && !loading && !error && (
        <div className="message-search-count">Найдено: {total}</div>
      )}

      <div className="message-search-body">
        {trimmed.length < MIN_QUERY_LEN ? (
          <div className="message-search-hint">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <p>Введите минимум {MIN_QUERY_LEN} символа для поиска по каналу</p>
          </div>
        ) : loading ? (
          <div className="message-search-hint">
            <div className="message-search-spinner" aria-label="Загрузка" />
          </div>
        ) : error ? (
          <div className="message-search-hint message-search-error">
            <p>{error}</p>
          </div>
        ) : results.length === 0 ? (
          <div className="message-search-hint">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            <p>Ничего не найдено по запросу «{trimmed}»</p>
          </div>
        ) : (
          <>
            {results.map((msg) => (
              <button
                key={msg.id}
                type="button"
                className="message-search-result"
                onClick={() => onJumpToMessage(msg.id)}
              >
                <div className="message-search-result-avatar">
                  {msg.username.charAt(0).toUpperCase()}
                </div>
                <div className="message-search-result-main">
                  <div className="message-search-result-meta">
                    <span className="message-search-result-author">{msg.username}</span>
                    <span className="message-search-result-date">{formatResultDate(msg.created_at)}</span>
                  </div>
                  <p className="message-search-result-text">
                    {highlightMatches(snippetAround(msg.content, trimmed), trimmed)}
                  </p>
                </div>
              </button>
            ))}
            {results.length < total && (
              <button
                type="button"
                className="message-search-more"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Загрузка…' : 'Показать ещё'}
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
