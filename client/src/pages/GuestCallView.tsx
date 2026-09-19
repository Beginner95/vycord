import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessageSquare, MicOff, Mic, Users, X } from 'lucide-react';
import { CallStage } from '@/components/CallStage';
import { Composer, type ComposerHandle } from '@/components/Composer';
import { MessageRow } from '@/components/MessageRow';
import { DayDivider } from '@/components/DayDivider';
import { MediaLightbox, pickLightboxMedia } from '@/components/MediaLightbox';
import { Avatar } from '@/components/Avatar';
import { useGuestCallStore } from '@/stores/guestCallStore';
import { useCallStore } from '@/stores/callStore';
import type { ChatMessage } from '@/stores/messageStore';
import type { GuestChatMessage } from '@/services/guestApi';
import type { Attachment, MemberWithUser } from '@/types';
import { isContinuation } from '@/utils/messageGroups';
import { useT, useDateFormat, isSameCalendarDay } from '@/i18n';
import { guestErrorText } from './guestErrors';
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
          {panel === 'chat' ? <GuestChatPanel /> : <GuestParticipantsPanel />}
        </aside>
      )}
    </div>
  );
}

// ─── Чат ─────────────────────────────────────────────────────────────────────

function toChatMessage(m: GuestChatMessage, channelId: string): ChatMessage {
  const isGuest = m.author.kind === 'guest';
  return {
    id: m.id,
    channel_id: channelId,
    user_id: isGuest ? null : (m.author.user_id ?? null),
    guest: isGuest ? { id: m.author.guest_id ?? '', display_name: m.author.display_name ?? '' } : undefined,
    content: m.content,
    kind: 'user',
    attachments: m.attachments,
    sticker_id: m.sticker_id,
    sticker: m.sticker,
    created_at: m.created_at,
    updated_at: m.updated_at ?? m.created_at,
  };
}

function GuestChatPanel() {
  const t = useT();
  const { formatFullDate } = useDateFormat();
  const rawMessages = useGuestCallStore((s) => s.messages);
  const sendChat = useGuestCallStore((s) => s.sendChat);
  const guestId = useGuestCallStore((s) => s.guestId);
  const displayName = useGuestCallStore((s) => s.displayName);
  const channelId = useGuestCallStore((s) => s.roomId) ?? '';
  const channelName = useGuestCallStore((s) => s.preview?.channel_name) ?? '';
  const rosterUsers = useGuestCallStore((s) => s.participants.users);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [lightbox, setLightbox] = useState<{ attachments: Attachment[]; index: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);

  const messages = useMemo(() => rawMessages.map((m) => toChatMessage(m, channelId)), [rawMessages, channelId]);

  // Упоминания в чужих сообщениях показываем по составу звонка: список
  // участников сервера гостю не положен.
  const members = useMemo<MemberWithUser[]>(
    () => rosterUsers.map((u) => ({
      user_id: u.user_id,
      username: u.username ?? u.user_id.slice(0, 8),
      avatar_url: u.avatar_url,
      roles: [],
      joined_at: '',
    })),
    [rosterUsers],
  );

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  const send = (content: string) => {
    void sendChat(content).then(
      () => setError(null),
      (err: { code?: string; message?: string }) => setError({ code: err.code, message: err.message ?? '' }),
    );
  };

  return (
    <>
      <div className="guest-chat-feed" ref={listRef}>
        <p className="guest-chat-hint">{t('guest.chatHint')}</p>
        {messages.map((msg, idx) => {
          const prev = messages[idx - 1];
          const date = new Date(msg.created_at);
          const dayChanged = !prev || !isSameCalendarDay(date, new Date(prev.created_at));
          const isOwn = Boolean(msg.guest && msg.guest.id === guestId);
          const author = rawMessages[idx].author;
          const name = msg.guest
            ? msg.guest.display_name
            : (author.username ?? author.user_id?.slice(0, 8) ?? '');
          return (
            <Fragment key={msg.id}>
              {dayChanged && <DayDivider label={formatFullDate(date)} />}
              <MessageRow
                msg={msg}
                isOwn={isOwn}
                isContinuation={!dayChanged && isContinuation(prev, msg)}
                displayName={isOwn ? displayName : name}
                avatarUrl={author.avatar_url}
                isEditing={false}
                highlighted={false}
                entered={false}
                members={members}
                canMentionEveryone={false}
                canModify={false}
                onStartEdit={() => {}}
                onCancelEdit={() => {}}
                onSaveEdit={async () => {}}
                onDelete={() => {}}
                onQuote={() => composerRef.current?.insertQuote(msg.content)}
                onOpenAttachment={(index) => setLightbox(pickLightboxMedia(msg.attachments ?? [], index))}
              />
            </Fragment>
          );
        })}
      </div>
      {error && <p className="guest-chat-error">{guestErrorText(error, t)}</p>}
      <div className="guest-chat-composer">
        <Composer
          ref={composerRef}
          channel={{ id: channelId, name: channelName, server_id: '' }}
          members={members}
          canMentionEveryone={false}
          onSend={send}
          textOnly
        />
      </div>
      {lightbox && (
        <MediaLightbox
          attachments={lightbox.attachments}
          index={lightbox.index}
          onIndexChange={(index) => setLightbox((cur) => (cur ? { ...cur, index } : cur))}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

// ─── Участники ───────────────────────────────────────────────────────────────

function GuestParticipantsPanel() {
  const t = useT();
  const participants = useGuestCallStore((s) => s.participants);
  const guestId = useGuestCallStore((s) => s.guestId);
  const selfMuted = useCallStore((s) => s.isMuted);
  const remoteMicMuted = useCallStore((s) => s.remoteMicMuted);
  const selfIdentity = guestId ? `guest:${guestId}` : '';

  const rows = [
    ...participants.users.map((u) => ({
      id: u.user_id,
      name: u.username ?? u.user_id.slice(0, 8),
      avatarUrl: u.avatar_url,
      isGuest: false,
    })),
    ...participants.guests.map((g) => ({ id: g.id, name: g.display_name, avatarUrl: undefined, isGuest: true })),
  ];

  return (
    <ul className="guest-roster">
      {rows.map((row) => {
        const isSelf = row.id === selfIdentity;
        const muted = isSelf ? selfMuted : (remoteMicMuted.get(row.id) ?? false);
        return (
          <li key={row.id} className="guest-roster-row">
            <Avatar username={row.name} url={row.avatarUrl} className="guest-roster-avatar" />
            <span className="guest-roster-name">{row.name}</span>
            {row.isGuest && <span className="guest-roster-chip">{t('guest.guestBadge')}</span>}
            {isSelf && <span className="guest-roster-chip is-self">{t('guest.youBadge')}</span>}
            <span className={`guest-roster-mic${muted ? ' is-muted' : ''}`}>
              {muted ? <MicOff size={14} strokeWidth={1.8} /> : <Mic size={14} strokeWidth={1.8} />}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
