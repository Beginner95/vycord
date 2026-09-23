import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Composer, type ComposerHandle } from '@/components/Composer';
import { MessageRow } from '@/components/MessageRow';
import { DayDivider } from '@/components/DayDivider';
import { MediaLightbox, pickLightboxMedia } from '@/components/MediaLightbox';
import { useGuestCallStore } from '@/stores/guestCallStore';
import type { ChatMessage } from '@/stores/messageStore';
import type { GuestChatMessage } from '@/services/guestApi';
import type { Attachment, MemberWithUser } from '@/types';
import { isContinuation } from '@/utils/messageGroups';
import { useT, useDateFormat, isSameCalendarDay } from '@/i18n';
import { guestErrorText } from '@/pages/guestErrors';

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

/** Тело гостевого чата — та же лента (MessageRow) с тем же композером в режиме
 *  «только текст», что была встроена в `GuestCallView`. Используется и
 *  десктопным aside (`GuestCallView.tsx`, неизменно), и мобильным
 *  `GuestChatScreen` (этап 6). */
export function GuestChatBody() {
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
