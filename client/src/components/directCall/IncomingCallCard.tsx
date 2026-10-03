import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Phone, PhoneOff } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { useDirectCallStore } from '@/stores/directCallStore';
import { requestAttention } from '@/services/desktopAttention';
import { useT } from '@/i18n';
import './IncomingCallCard.css';

/**
 * Карточка входящего звонка 1:1 — без затемнения, приложение под ней живое.
 * Намеренно НЕ блокирующий слой: не регистрируется в стеке useModalFocus и не
 * носит .modal-overlay, поэтому Escape/Tab/⌘K её не замечают.
 */
export function IncomingCallCard() {
  const t = useT();
  const phase = useDirectCallStore((s) => s.phase);
  const accept = useDirectCallStore((s) => s.accept);
  const reject = useDirectCallStore((s) => s.reject);
  const incoming = phase.kind === 'incoming' ? phase : null;

  useEffect(() => {
    if (incoming) requestAttention(t('directCall.incomingTitle'), t('directCall.incomingBody', { name: incoming.peer.username }));
    // Уведомление — один раз на вызов, не на каждый ре-рендер.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming?.callId]);

  if (!incoming) return null;
  return createPortal(
    <div className="incoming-call-card" role="alertdialog" aria-label={t('directCall.incomingTitle')} aria-describedby="incoming-call-desc">
      <Avatar url={incoming.peer.avatar_url ?? undefined} username={incoming.peer.username} className="incoming-call-avatar" />
      <div className="incoming-call-text" id="incoming-call-desc">
        <span className="incoming-call-name">{incoming.peer.username}</span>
        <span className="incoming-call-sub">{t('directCall.callingYou')}</span>
        {incoming.wouldSwitch && <span className="incoming-call-warn">{t('directCall.acceptEndsCurrent')}</span>}
      </div>
      <div className="incoming-call-actions">
        <button type="button" className="incoming-call-reject" onClick={reject} aria-label={t('directCall.decline')} title={t('directCall.decline')}>
          <PhoneOff size={18} strokeWidth={1.8} />
        </button>
        <button type="button" className="incoming-call-accept" onClick={accept} aria-label={t('directCall.accept')} title={t('directCall.accept')}>
          <Phone size={18} strokeWidth={1.8} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
