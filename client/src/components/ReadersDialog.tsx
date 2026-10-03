import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useT } from '@/i18n';
import { useModalFocus } from '@/hooks/useModalFocus';
import { apiService } from '@/services/api';
import { Avatar } from '@/components/Avatar';
import type { MessageReader, MessageReaders } from '@/types';
import './ReadersDialog.css';

type ReadersState = { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: MessageReaders };

/** Снимок на момент открытия: живого обновления нет (спека §0, YAGNI). */
function useMessageReaders(channelId: string, messageId: string): ReadersState {
  const [state, setState] = useState<ReadersState>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    apiService.getMessageReaders(channelId, messageId)
      .then((data) => { if (alive) setState({ status: 'ok', data }); })
      .catch(() => { if (alive) setState({ status: 'error' }); });
    return () => { alive = false; };
  }, [channelId, messageId]);
  return state;
}

/** Содержимое «Кто прочитал» — общее для десктопной модалки и мобильной шторки. */
export function ReadersList({ channelId, messageId }: { channelId: string; messageId: string }) {
  const t = useT();
  const st = useMessageReaders(channelId, messageId);
  if (st.status === 'loading') return <div className="readers-status">{t('chat.readersLoading')}</div>;
  if (st.status === 'error') return <div className="readers-status is-error">{t('chat.readersError')}</div>;
  return (
    <div className="readers-list">
      <ReadersSection title={t('chat.readersRead', { count: String(st.data.read.length) })} users={st.data.read} />
      <ReadersSection title={t('chat.readersUnread', { count: String(st.data.unread.length) })} users={st.data.unread} />
    </div>
  );
}

function ReadersSection({ title, users }: { title: string; users: MessageReader[] }) {
  const t = useT();
  return (
    <section className="readers-section">
      <h3 className="readers-section-title">{title}</h3>
      {users.length === 0 ? (
        <div className="readers-empty">{t('chat.readersEmpty')}</div>
      ) : (
        <ul className="readers-users">
          {users.map((u) => (
            <li key={u.user_id} className="readers-user">
              <Avatar url={u.avatar_url} username={u.username} className="readers-user-avatar" />
              <span className="readers-user-name">{u.username}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Десктоп: компактная модалка по контракту оверлеев (.modal-overlay + useModalFocus). */
export function ReadersDialog({ channelId, messageId, onClose }: { channelId: string; messageId: string; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(true, ref, onClose);
  return (
    <div className="modal-overlay" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div
        ref={ref}
        className="modal readers-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('chat.readersTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('chat.readersTitle')}</h2>
          <button type="button" className="modal-close-btn" aria-label={t('common.close')} data-autofocus onClick={onClose}>
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
        <ReadersList channelId={channelId} messageId={messageId} />
      </div>
    </div>
  );
}
