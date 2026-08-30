import { useState, useEffect, useRef } from 'react';
import { Search, SearchX, X } from 'lucide-react';
import { apiService, apiErrorText } from '@/services/api';
import type { Channel, MessageWithAuthor, MessageSearchResponse } from '@/types';
import { useT, useTp, useDateFormat } from '@/i18n';
import { Avatar } from '@/components/Avatar';
import { snippetAround, splitMatches } from '@/utils/searchSnippet';
import './MessageSearch.css';

const MIN_QUERY_LEN = 2;
const PAGE_SIZE = 25;
const DEBOUNCE_MS = 300;

interface MessageSearchProps {
  channel: Channel;
  initialQuery?: string;
  onJumpToMessage: (messageId: string) => void;
  onClose: () => void;
}

function formatResultDate(
  dateStr: string,
  fmt: { formatTime: (d: Date) => string; formatDayMonth: (d: Date) => string },
) {
  const date = new Date(dateStr);
  const day = fmt.formatDayMonth(date);
  const time = fmt.formatTime(date);
  return `${day}, ${time}`;
}

export function MessageSearch({ channel, initialQuery = '', onJumpToMessage, onClose }: MessageSearchProps) {
  const t = useT();
  const tp = useTp();
  const fmt = useDateFormat();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<MessageWithAuthor[]>([]);
  const [total, setTotal] = useState(0);
  // Seeded mount (palette's show-all handoff) commits with a query that will
  // certainly fire the search effect below — initialising loading from that
  // fact avoids a one-frame flash of the empty-results tile before the effect
  // (which runs post-commit) sets loading itself.
  const [loading, setLoading] = useState(initialQuery.trim().length >= MIN_QUERY_LEN);
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
    <aside className="message-search" aria-label={t('chat.searchMessages')}>
      <div className="message-search-header">
        <div className="message-search-input-wrap">
          <Search size={17} strokeWidth={1.8} className="message-search-input-icon" />
          <input
            ref={inputRef}
            type="text"
            className="input message-search-field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder={t('chat.searchPlaceholder', { channel: channel.name })}
            maxLength={100}
          />
          {query && (
            <button type="button" className="message-search-clear" aria-label={t('common.clear')} onClick={() => setQuery('')}>
              <X size={14} strokeWidth={1.8} />
            </button>
          )}
        </div>
        <button type="button" className="message-search-close" aria-label={t('chat.closeSearch')} onClick={onClose}>
          <X size={16} strokeWidth={1.8} />
        </button>
      </div>

      {searched && !loading && !error && (
        <div className="message-search-count">{tp('chat.foundCount', total)}</div>
      )}

      <div className="message-search-body">
        {trimmed.length < MIN_QUERY_LEN ? (
          <div className="message-search-hint">
            <Search size={22} strokeWidth={1.8} />
            <p>{tp('chat.minQueryLength', MIN_QUERY_LEN)}</p>
          </div>
        ) : loading ? (
          <div className="message-search-hint">
            <div className="message-search-spinner" aria-label={t('common.loading')} />
          </div>
        ) : error ? (
          <div className="message-search-hint message-search-error">
            <p>{error}</p>
          </div>
        ) : results.length === 0 ? (
          <div className="message-search-empty">
            <div className="message-search-empty-tile">
              <SearchX size={22} strokeWidth={1.8} />
            </div>
            <h3 className="message-search-empty-title">{t('chat.nothingFoundTitle')}</h3>
            <p>{t('chat.nothingFound', { query: trimmed })}</p>
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
                <Avatar username={msg.username} className="message-search-result-avatar" />
                <div className="message-search-result-main">
                  <div className="message-search-result-meta">
                    <span className="message-search-result-author">{msg.username}</span>
                    <span className="message-search-result-date">{formatResultDate(msg.created_at, fmt)}</span>
                  </div>
                  <p className="message-search-result-text">
                    {splitMatches(snippetAround(msg.content, trimmed), trimmed).map((part, i) =>
                      part.match ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>,
                    )}
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
                {loadingMore ? t('common.loading') : t('chat.loadMore')}
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
