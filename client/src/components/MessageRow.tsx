import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Pencil, Trash2, Quote, Clock } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { FormattingToolbar } from '@/components/FormattingToolbar';
import { MentionDropdown } from '@/components/MentionDropdown';
import { ExpressionPicker } from '@/components/ExpressionPicker';
import { LinkDialog } from '@/components/LinkDialog';
import { MessageAttachments } from '@/components/MessageAttachments';
import { useMentionAutocomplete } from '@/hooks/useMentionAutocomplete';
import { toggleBullet, toggleNumbered, applyLineToggle, applyWrap, insertAtCaret, linkToken } from '@/utils/textTransforms';
import { tokenizeMentions, LEGACY_ROLE_KEYS } from '@/utils/mentions';
import { parseInline, blockify, normalizeLinkHref, type MdInlineNode } from '@/utils/markdown';
import { resolveUploadUrl } from '@/services/api';
import { useT, useDateFormat, type TFunc } from '@/i18n';
import type { ChatMessage } from '@/stores/messageStore';
import type { MemberWithUser } from '@/types';
import './MessageRow.css';

function renderMessageContent(content: string, members: MemberWithUser[], t: TFunc, currentUserId?: string) {
  return tokenizeMentions(content).map((token, i) => {
    if (token.type === 'text') {
      return token.value;
    }
    if (token.type === 'role') {
      return (
        // M6 T12: `msg-mention-role` dropped. It carried no CSS rule anywhere
        // (pre-existing since before M2), so it changed nothing visually, and it
        // is not an identity hook either — selector-sweep reports 0 CSS sites,
        // 0 querySelector sites and 0 prose references, so no probe addresses it.
        // Removed rather than given a rule: the design board says nothing about
        // role mentions, so styling them would be unrequested design.
        <span key={i} className="msg-mention">
          @{t(LEGACY_ROLE_KEYS[token.value])}
        </span>
      );
    }
    if (token.type === 'everyone') {
      return (
        <span key={i} className="msg-mention msg-mention-everyone">
          @everyone
        </span>
      );
    }
    const member = members.find((m) => m.user_id === token.value);
    const isSelf = token.value === currentUserId;
    return (
      <span key={i} className={`msg-mention${isSelf ? ' msg-mention-self' : ''}`}>
        @{member?.username ?? 'unknown-user'}
      </span>
    );
  });
}

function renderInlineNodes(nodes: MdInlineNode[], members: MemberWithUser[], t: TFunc, currentUserId?: string): ReactNode {
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'text':
        return <Fragment key={i}>{renderMessageContent(n.text, members, t, currentUserId)}</Fragment>;
      case 'strong':
        return <strong key={i}>{renderInlineNodes(n.children, members, t, currentUserId)}</strong>;
      case 'em':
        return <em key={i}>{renderInlineNodes(n.children, members, t, currentUserId)}</em>;
      case 'u':
        return <u key={i}>{renderInlineNodes(n.children, members, t, currentUserId)}</u>;
      case 'link':
        return (
          <a key={i} href={normalizeLinkHref(n.url)} target="_blank" rel="noopener noreferrer">
            {renderInlineNodes(n.label, members, t, currentUserId)}
          </a>
        );
    }
  });
}

function renderMessageBody(content: string, members: MemberWithUser[], t: TFunc, currentUserId?: string) {
  return blockify(content).map((b, i) => {
    switch (b.kind) {
      case 'plain':
        return <span key={i}>{renderInlineNodes(parseInline(b.text), members, t, currentUserId)}</span>;
      case 'quote':
        return <span key={i} className="msg-quote-block">{renderInlineNodes(parseInline(b.text), members, t, currentUserId)}</span>;
      case 'ol':
        return (
          <ol key={i}>
            {b.items.map((it, j) => (
              <li key={j}>{renderInlineNodes(parseInline(it), members, t, currentUserId)}</li>
            ))}
          </ol>
        );
      case 'ul':
        return (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>{renderInlineNodes(parseInline(it), members, t, currentUserId)}</li>
            ))}
          </ul>
        );
    }
  });
}

interface MessageRowProps {
  msg: ChatMessage;
  isOwn: boolean;
  isContinuation: boolean;
  displayName: string;
  avatarUrl?: string;
  isEditing: boolean;
  highlighted: boolean;
  entered: boolean;
  members: MemberWithUser[];
  currentUserId?: string;
  canMentionEveryone: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (content: string) => Promise<void>;
  onDelete: () => void;
  onQuote: () => void;
  /** Wired in Task 11 (failed-send retry). */
  onRetry?: () => void;
  /**
   * Final-review fix 3: the only exit from a `failed` row used to be retry.
   * Discard drops the row locally — it never reached the server, so there is
   * no API call and no confirm modal to justify.
   */
  onDiscard?: () => void;
  /**
   * M5.5 T3. The row renders its own attachments but does not own the
   * lightbox: one fullscreen overlay per message would be wasteful and the
   * column-level mount is ChatArea's. `index` is the row-local index into
   * `msg.attachments`; ChatArea narrows it to the media subset.
   */
  onOpenAttachment?: (index: number) => void;
}

export function MessageRow(props: MessageRowProps) {
  const { msg, isOwn, isContinuation, displayName, avatarUrl, isEditing, highlighted, entered } = props;
  const t = useT();
  const { formatTime } = useDateFormat();
  const isEdited = msg.updated_at !== msg.created_at;
  const time = formatTime(new Date(msg.created_at));

  const rowClass = [
    'msg-row',
    isOwn ? 'is-own' : '',
    isContinuation ? 'is-continuation' : '',
    entered ? 'is-entering' : '',
    highlighted ? 'is-highlight' : '',
    msg.deliveryState === 'sending' ? 'is-sending' : '',
    msg.deliveryState === 'failed' ? 'is-failed' : '',
  ].filter(Boolean).join(' ');

  return (
    <div data-message-id={msg.id} className={rowClass}>
      <div className="msg-gutter">
        {isContinuation
          ? <span className="msg-gutter-time">{time}</span>
          : <Avatar url={avatarUrl} username={displayName} className="msg-avatar" />}
      </div>
      <div className="msg-content">
        {!isContinuation && (
          <div className="msg-header">
            <span className="msg-author">{displayName}</span>
            {isOwn && <span className="msg-own-chip">{t('chat.youChip')}</span>}
            <span className="msg-time">
              {time}
              {isEdited && t('chat.edited')}
            </span>
          </div>
        )}
        {isEditing
          ? <MessageEditor initial={msg.content} {...props} />
          : msg.sticker_id && msg.sticker
            ? <img className="msg-sticker" src={resolveUploadUrl(msg.sticker.image_url)} alt={msg.sticker.name} />
            : msg.sticker_id
              ? <div className="msg-body">{t('chat.stickerRemoved')}</div>
              : msg.content
                ? <div className="msg-body">{renderMessageBody(msg.content, props.members, t, props.currentUserId)}</div>
                : null}
        {/* An attachment-only message has empty content — the body above is
            skipped so it does not render an empty block above the media. */}
        {!isEditing && msg.attachments && msg.attachments.length > 0 && (
          <MessageAttachments
            attachments={msg.attachments}
            onOpen={(index) => props.onOpenAttachment?.(index)}
          />
        )}
        {!isEditing && msg.deliveryState === 'sending' && (
          <span className="msg-delivery is-sending">
            <Clock size={12} strokeWidth={1.8} /> {t('chat.sending')}
          </span>
        )}
        {!isEditing && msg.deliveryState === 'failed' && (
          <button type="button" className="msg-delivery is-failed" onClick={props.onRetry}>
            {t('chat.sendFailed')} · {t('chat.retry')}
          </button>
        )}
      </div>
      {/* A sticker row has nothing to quote (quoting it inserts a bare `> `)
          and nothing to edit, so for someone else's sticker the popover would
          be an empty bordered chip on hover — don't render the wrapper at all. */}
      {!isEditing && !msg.deliveryState && (!msg.sticker_id || isOwn) && (
        <div className="msg-actions">
          {!msg.sticker_id && (
            <button type="button" className="msg-action-btn" aria-label={t('chat.quote')} title={t('chat.quote')} onClick={props.onQuote}>
              <Quote size={15} strokeWidth={1.8} />
            </button>
          )}
          {isOwn && !msg.sticker_id && (
            <button type="button" className="msg-action-btn" aria-label={t('common.edit')} title={t('common.edit')} onClick={props.onStartEdit}>
              <Pencil size={15} strokeWidth={1.8} />
            </button>
          )}
          {isOwn && (
            <button type="button" className="msg-action-btn is-danger" aria-label={t('common.delete')} title={t('common.delete')} onClick={props.onDelete}>
              <Trash2 size={15} strokeWidth={1.8} />
            </button>
          )}
        </div>
      )}
      {/* Failed rows get exactly one action — discard. Quote/edit/delete stay
          suppressed: the row has no server id, so edit/delete would PATCH or
          DELETE a `pending-*` that does not exist. `sending` rows get nothing
          at all until they resolve one way or the other. */}
      {!isEditing && msg.deliveryState === 'failed' && (
        <div className="msg-actions">
          <button
            type="button"
            className="msg-action-btn is-danger"
            aria-label={t('chat.discardFailed')}
            title={t('chat.discardFailed')}
            onClick={props.onDiscard}
          >
            <Trash2 size={15} strokeWidth={1.8} />
          </button>
        </div>
      )}
    </div>
  );
}

interface MessageEditorProps extends MessageRowProps {
  initial: string;
}

/**
 * Inline editor for one message. Owns its whole edit-session state (value,
 * mention autocomplete, expression picker, link dialog) so it is created on
 * "start edit" and thrown away on save/cancel — no per-message edit state
 * has to live in ChatArea any more.
 */
function MessageEditor({ initial, members, canMentionEveryone, onCancelEdit, onSaveEdit }: MessageEditorProps) {
  const [value, setValue] = useState(initial);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const mention = useMentionAutocomplete({ value, setValue, inputRef, members, canMentionEveryone });

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const target = { ref: inputRef, value, setValue };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.handleKeyDown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void onSaveEdit(value.trim());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancelEdit();
    }
  };

  return (
    <div className="msg-edit">
      <textarea
        ref={inputRef}
        className="msg-edit-input"
        value={value}
        onChange={mention.handleChange}
        onKeyDown={handleKeyDown}
        // Clicking inside the link dialog or the emoji grid blurs the textarea
        // before its click handler runs — cancelling the edit would eat the very
        // action the user asked for, so blur only cancels with no popover open.
        onBlur={() => { if (!linkOpen && !pickerOpen) onCancelEdit(); }}
        maxLength={2000}
        rows={1}
        autoFocus
      />
      <FormattingToolbar
        onWrap={(marker) => applyWrap(target, marker)}
        onBullet={() => applyLineToggle(target, toggleBullet)}
        onNumbered={() => applyLineToggle(target, toggleNumbered)}
        onLink={() => setLinkOpen(true)}
        onPickerToggle={() => setPickerOpen((open) => !open)}
        pickerOpen={pickerOpen}
      />
      <MentionDropdown mention={mention} />
      {pickerOpen && (
        <ExpressionPicker
          tabs={['emoji']}
          onClose={() => setPickerOpen(false)}
          onSelectEmoji={(emoji) => { insertAtCaret(target, emoji); setPickerOpen(false); }}
        />
      )}
      <LinkDialog
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        onInsert={(label, url) => { insertAtCaret(target, linkToken(label, url)); setLinkOpen(false); }}
      />
    </div>
  );
}
