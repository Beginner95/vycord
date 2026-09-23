import { useEffect, useState } from 'react';
import { Loader2, MessageSquare, Users, X } from 'lucide-react';
import { CallStage } from '@/components/CallStage';
import { useGuestCallStore } from '@/stores/guestCallStore';
import { useT } from '@/i18n';
import { GuestChatBody } from './guest/GuestChatBody';
import { GuestParticipantsBody } from './guest/GuestParticipantsBody';
import './GuestCallView.css';

/**
 * Звонок гостя — та же сцена, что у участника с аккаунтом (CallStage в
 * гостевом режиме), и сбоку та же лента сообщений (MessageRow) с тем же
 * композером в режиме «только текст». Спека:
 * docs/superpowers/specs/2026-09-17-guest-call-link-design.md, «Страница гостя».
 */

type SidePanel = 'chat' | 'participants' | null;

export function GuestCallView() {
  const t = useT();
  const phase = useGuestCallStore((s) => s.phase);
  const leave = useGuestCallStore((s) => s.leave);
  const chatUnread = useGuestCallStore((s) => s.chatUnread);
  const markChatRead = useGuestCallStore((s) => s.markChatRead);
  const rosterSize = useGuestCallStore((s) => s.participants.users.length + s.participants.guests.length);
  const [panel, setPanel] = useState<SidePanel>(null);

  // Непрочитанное гасим, пока чат открыт: новые сообщения видны сразу.
  useEffect(() => {
    if (panel === 'chat' && chatUnread > 0) markChatRead();
  }, [panel, chatUnread, markChatRead]);

  if (phase !== 'in_call') {
    return (
      <div className="guest-page guest-page-stage">
        <div className="guest-status">
          <Loader2 size={28} strokeWidth={1.8} className="guest-spinner" />
          <span>{t('guest.connecting')}</span>
        </div>
      </div>
    );
  }

  const toggle = (next: Exclude<SidePanel, null>) => setPanel((cur) => (cur === next ? null : next));

  const extraControls = (
    <>
      <div className="stage-ctl">
        <span className="guest-ctl-wrap">
          <button
            type="button"
            className={`stage-ctl-btn${panel === 'chat' ? ' is-on' : ''}`}
            onClick={() => toggle('chat')}
            title={t('guest.chat')}
            aria-pressed={panel === 'chat'}
          >
            <MessageSquare size={16} strokeWidth={1.8} />
          </button>
          {chatUnread > 0 && panel !== 'chat' && <span className="guest-ctl-badge">{chatUnread}</span>}
        </span>
        <span className="stage-ctl-label">{t('guest.chat')}</span>
      </div>
      <div className="stage-ctl">
        <button
          type="button"
          className={`stage-ctl-btn${panel === 'participants' ? ' is-on' : ''}`}
          onClick={() => toggle('participants')}
          title={t('guest.participants')}
          aria-pressed={panel === 'participants'}
        >
          <Users size={16} strokeWidth={1.8} />
        </button>
        <span className="stage-ctl-label">{rosterSize > 0 ? rosterSize : t('guest.participants')}</span>
      </div>
    </>
  );

  return (
    <div className="guest-call">
      <div className="guest-call-main">
        <CallStage onLeave={() => void leave()} extraControls={extraControls} />
      </div>
      {panel && (
        <aside className="guest-side">
          <div className="guest-side-head">
            <span className="guest-side-title">
              {panel === 'chat' ? t('guest.chat') : t('guest.participants')}
            </span>
            <button
              type="button"
              className="panel-icon-btn"
              onClick={() => setPanel(null)}
              aria-label={t('guest.close')}
              title={t('guest.close')}
            >
              <X size={16} strokeWidth={1.8} />
            </button>
          </div>
          {panel === 'chat' ? <GuestChatBody /> : <GuestParticipantsBody />}
        </aside>
      )}
    </div>
  );
}
