import { Fragment, useState, useEffect, useRef, useCallback, type FormEvent, type KeyboardEvent, type ChangeEvent, type ClipboardEvent } from 'react';
import { ArrowDown, ChevronLeft, Hash, Headphones, Mic, Quote, Search, Users } from 'lucide-react';
import { useMessageStore } from '@/stores/messageStore';
import { LinkDialog } from '@/components/LinkDialog';
import { EmojiPicker } from '@/components/EmojiPicker';
import { StickerPicker } from '@/components/StickerPicker';
import { StickerManager } from '@/components/StickerManager';
import { toggleQuote, toggleBullet, toggleNumbered, applyLineToggle, applyWrap, insertAtCaret, linkToken } from '@/utils/textTransforms';
import { isUnsafeUrl } from '@/utils/markdown';
import type { Message } from '@/types';
import { apiService, apiErrorText, ApiError } from '@/services/api';
import { wsService } from '@/services/websocket';
import { audioService } from '@/services/audio';
import { useServerStore } from '@/stores/serverStore';
import { useCallStore } from '@/stores/callStore';
import { logger } from '@/utils/logger';
import { collectUnresolvedUserIds } from '@/utils/userCache';
import { isContinuation } from '@/utils/messageGroups';
import { useMentionAutocomplete } from '@/hooks/useMentionAutocomplete';
import { can, PERMISSIONS } from '@/utils/permissions';
import { useFloatingSelectionToolbar } from '@/hooks/useFloatingSelectionToolbar';
import { MessageSearch } from '@/components/MessageSearch';
import { MessageRow } from '@/components/MessageRow';
import { MentionDropdown } from '@/components/MentionDropdown';
import { DayDivider } from '@/components/DayDivider';
import { ConfirmModal } from '@/components/ConfirmModal';
import type { Channel, User } from '@/types';
import type { Sticker } from '@/types';
import { useT, useDateFormat, isSameCalendarDay } from '@/i18n';
import './ChatArea.css';

interface ChatAreaProps {
  channel: Channel | null;
  user: User | null;
  onMobileBack?: () => void;
  onShowMembers?: () => void;
  onJoinVoice?: (channel: Channel) => void;
  onShowCall?: () => void;
}

const QUOTE_PREFIX = '> ';

function lineRangeForSelection(value: string, start: number, end: number) {
  const lineStart = start <= 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
  // A selection that ends exactly at the start of a new line (e.g. Shift+Down
  // stopping at column 0 of the next line) has selected 0 characters of that
  // line — don't treat it as touched.
  const selEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const searchFrom = Math.max(selEnd, lineStart);
  const endIdx = value.indexOf('\n', searchFrom);
  const lineEnd = endIdx === -1 ? value.length : endIdx;
  return { lineStart, lineEnd };
}

function FloatingQuoteButton({ x, y, onConfirm }: { x: number; y: number; onConfirm: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className="chat-quote-float"
      style={{ left: x, top: y }}
      aria-label={t('chat.quote')}
      title={t('chat.quote')}
      onMouseDown={(e) => {
        e.preventDefault();
        onConfirm();
      }}
    >
      <Quote size={16} strokeWidth={1.8} />
    </button>
  );
}

export function ChatArea({ channel, user, onMobileBack, onShowMembers, onJoinVoice, onShowCall }: ChatAreaProps) {
  const callChannelId = useCallStore((s) => s.callChannelId);
  const t = useT();
  const { formatFullDate } = useDateFormat();
  const { messages, loading, setMessages, addMessage, updateMessage, removeMessage } = useMessageStore();
  const { members, currentServer } = useServerStore();
  const [input, setInput] = useState('');
  const [caretInQuoteLine, setCaretInQuoteLine] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyMode, setHistoryMode] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [stickerManagerOpen, setStickerManagerOpen] = useState(false);
  const [serverStickers, setServerStickers] = useState<Sticker[]>([]);

  // Cache for user info (id → username)
  const [userCache, setUserCache] = useState<Map<string, { username: string; avatar_url?: string }>>(new Map());
  const userCacheRef = useRef(userCache);
  useEffect(() => {
    userCacheRef.current = userCache;
  }, [userCache]);
  const pendingUserFetchesRef = useRef(new Set<string>());

  const permissions = useServerStore((s) => (currentServer ? s.permissions.get(currentServer.id) : undefined));
  const canMentionEveryone = can(permissions, PERMISSIONS.MENTION_EVERYONE);
  const canManageStickers = can(permissions, PERMISSIONS.MANAGE_SERVER);

  const composeMention = useMentionAutocomplete({
    value: input,
    setValue: setInput,
    inputRef,
    members,
    canMentionEveryone,
  });

  useEffect(() => {
    if (historyMode) return; // в режиме просмотра истории не утаскиваем вниз
    scrollToBottom();
  }, [messages, historyMode]);

  useEffect(() => {
    inputRef.current?.focus();
    composeMention.reset();
    setEditingId(null);
    setCaretInQuoteLine(false);
    setSearchOpen(false);
    setHistoryMode(false);
    setHighlightedId(null);
    setConfirmDeleteId(null);
  }, [channel?.id]);

  // Only rows *appended* to the list already on screen animate in (220ms).
  // "Appended" is derived from the list itself rather than from explicit reset
  // calls at every setMessages site: a channel switch, a jump-to-message, a
  // back-to-latest, a delete, or a stale fetch landing after the user has moved
  // on all produce a list whose predecessor is not a prefix of it, and each of
  // those must re-seed the baseline silently instead of stagger-flashing the
  // whole batch. Growing a previously EMPTY list only animates a single-message
  // append (the first message in a fresh channel) — a bulk fill of an empty
  // list is the initial channel load, not something the user just did.
  const prevIdsRef = useRef<string[]>([]);
  const [enteredIds, setEnteredIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ids = messages.map((m) => m.id);
    const prev = prevIdsRef.current;
    prevIdsRef.current = ids;
    const isAppend =
      (prev.length > 0 || ids.length === 1) &&
      ids.length >= prev.length &&
      prev.every((id, i) => id === ids[i]);
    if (!isAppend) {
      setEnteredIds((current) => (current.size ? new Set() : current));
      return;
    }
    const fresh = ids.slice(prev.length);
    if (fresh.length) {
      setEnteredIds((current) => {
        const next = new Set(current);
        fresh.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [messages]);

  const refreshStickers = useCallback(() => {
    const sid = currentServer?.id;
    if (sid) {
      apiService.listStickers(sid).then((s) => {
        if (sid === currentServer?.id) setServerStickers(s);
      }).catch(() => {});
    }
  }, [currentServer?.id]);

  useEffect(() => {
    if (channel?.id) refreshStickers();
  }, [channel?.id, refreshStickers]);

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f' || e.code === 'KeyF')) {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // Fetch usernames for all unique user_ids in messages
  useEffect(() => {
    const fetchUsernames = async () => {
      const candidateIds = messages.map((msg) => msg.user_id);
      const userIds = collectUnresolvedUserIds(
        candidateIds,
        user?.id,
        (id) => userCacheRef.current.has(id),
        (id) => pendingUserFetchesRef.current.has(id)
      );
      for (const uid of userIds) {
        if (pendingUserFetchesRef.current.has(uid) || userCacheRef.current.has(uid)) continue;
        pendingUserFetchesRef.current.add(uid);
        try {
          const fetchedUser = await apiService.getUserById(uid) as User;
          setUserCache((prev) => {
            const next = new Map(prev);
            next.set(fetchedUser.id, { username: fetchedUser.username, avatar_url: fetchedUser.avatar_url });
            return next;
          });
        } catch {
          setUserCache((prev) => {
            const next = new Map(prev);
            next.set(uid, { username: uid.slice(0, 8) });
            return next;
          });
        } finally {
          pendingUserFetchesRef.current.delete(uid);
        }
      }
    };
    if (messages.length > 0) {
      fetchUsernames();
    }
  }, [messages, user]);

  // Play sound for incoming messages (from other users)
  useEffect(() => {
    const handleMessage = async (payload: unknown) => {
      const msg = payload as Record<string, unknown>;
      if (user && msg.user_id !== user.id) {
        audioService.playMessage();
        // Cache username if not already cached
        const uid = msg.user_id as string | undefined;
        const unresolvedIds = collectUnresolvedUserIds(
          uid ? [uid] : [],
          user.id,
          (id) => userCacheRef.current.has(id),
          (id) => pendingUserFetchesRef.current.has(id)
        );
        for (const unresolvedId of unresolvedIds) {
          if (pendingUserFetchesRef.current.has(unresolvedId) || userCacheRef.current.has(unresolvedId)) continue;
          pendingUserFetchesRef.current.add(unresolvedId);
          try {
            const fetchedUser = await apiService.getUserById(unresolvedId) as User;
            setUserCache((prev) => {
              const next = new Map(prev);
              next.set(fetchedUser.id, { username: fetchedUser.username, avatar_url: fetchedUser.avatar_url });
              return next;
            });
          } catch {
            setUserCache((prev) => {
              const next = new Map(prev);
              next.set(unresolvedId, { username: 'Unknown' });
              return next;
            });
          } finally {
            pendingUserFetchesRef.current.delete(unresolvedId);
          }
        }
      }
    };
    const unsub = wsService.on('chat_message', handleMessage);
    return unsub;
  }, [user]);

  useEffect(() => {
    const unsubUpdate = wsService.on('message_update', (payload) => {
      const msg = payload as Message;
      updateMessage(msg.id, msg);
    });
    const unsubDelete = wsService.on('message_delete', (payload) => {
      const { id } = payload as { id: string; channel_id: string };
      removeMessage(id);
    });
    return () => {
      unsubUpdate();
      unsubDelete();
    };
  }, [updateMessage, removeMessage]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const jumpToMessage = async (messageId: string) => {
    if (!channel) return;
    try {
      const context = await apiService.getMessagesAround(channel.id, messageId) as Message[];
      setHistoryMode(true);
      setMessages(context);
      setHighlightedId(messageId);
      requestAnimationFrame(() => {
        chatMessagesRef.current
          ?.querySelector(`[data-message-id="${messageId}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      window.setTimeout(() => setHighlightedId(null), 2200);
    } catch (err) {
logger.error('Failed to jump to message:', err, { module: 'chat' });
      setSendError(apiErrorText(err, t));
      setTimeout(() => setSendError(null), 5000);
    }
  };

  const backToLatest = async () => {
    if (!channel) return;
    try {
      const latest = await apiService.getMessages(channel.id) as Message[];
      setHistoryMode(false);
      setHighlightedId(null);
      setMessages(latest);
    } catch (err) {
      logger.error('Failed to load latest messages:', err, { module: 'chat' });
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!channel || !input.trim() || !user) return;

    try {
      const msg = await apiService.createMessage(channel.id, input.trim()) as Message;
      addMessage(msg);
      setInput('');
      setCaretInQuoteLine(false);
    } catch (err) {
      logger.error('Failed to send message:', err, { module: 'chat' });
      setSendError(apiErrorText(err, t));
      setTimeout(() => setSendError(null), 5000);
    }
  };

  const sendSticker = async (sticker: Sticker) => {
    if (!channel || !user) return;
    try {
      const msg = await apiService.createMessage(channel.id, '', sticker.id) as Message;
      addMessage(msg);
      setStickerPickerOpen(false);
    } catch (err) {
      setSendError(apiErrorText(err, t));
      setTimeout(() => setSendError(null), 5000);
    }
  };

  const handleComposeKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (composeMention.handleKeyDown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  };

  const updateQuoteButtonActive = (value: string = input, caret?: number) => {
    const el = inputRef.current;
    const pos = caret ?? el?.selectionStart ?? 0;
    const { lineStart, lineEnd } = lineRangeForSelection(value, pos, pos);
    setCaretInQuoteLine(value.slice(lineStart, lineEnd).startsWith(QUOTE_PREFIX));
  };

  const handleComposeChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    composeMention.handleChange(e);
    updateQuoteButtonActive(e.target.value, e.target.selectionStart ?? undefined);
  };

  const composeTarget = { ref: inputRef, value: input, setValue: setInput };

  const toggleQuotePrefixRange = (start: number, end: number) => {
    const el = inputRef.current;
    const r = toggleQuote(input, start, end);
    setInput(r.value);
    setCaretInQuoteLine(!r.allPrefixed);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(r.start, r.end);
    });
  };

  const toggleQuotePrefix = () => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? input.length;
    toggleQuotePrefixRange(start, end);
  };

  const composeWrap = (marker: string) => applyWrap(composeTarget, marker);
  const composeBullet = () => applyLineToggle(composeTarget, toggleBullet);
  const composeNumbered = () => applyLineToggle(composeTarget, toggleNumbered);

  const [linkOpen, setLinkOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const insertLink = (label: string, url: string) => {
    insertAtCaret(composeTarget, linkToken(label, url));
    setLinkOpen(false);
  };

  const handleComposePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const sel = el.value.slice(start, end);
    if (start !== end && sel.trim() && text.trim() && !isUnsafeUrl(text.trim())) {
      e.preventDefault();
      const token = `[${sel.trim()}](${text.trim()})`;
      const next = el.value.slice(0, start) + token + el.value.slice(end);
      setInput(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
      setCaretInQuoteLine(false);
    }
  };

  const composeSelectionToolbar = useFloatingSelectionToolbar({
    containerRef: inputRef,
    resubscribeKey: channel?.id,
    getSelectionInfo: (e) => {
      const el = inputRef.current;
      const start = el?.selectionStart;
      const end = el?.selectionEnd;
      if (!el || start == null || end == null || start === end) return null;
      const text = el.value.slice(start, end);
      if (e) return { text, x: e.clientX, y: e.clientY + 16 };
      const rect = el.getBoundingClientRect();
      return { text, x: rect.left + 24, y: rect.top - 8 };
    },
    onConfirm: () => {
      const el = inputRef.current;
      const start = el?.selectionStart;
      const end = el?.selectionEnd;
      if (!el || start == null || end == null) return;
      toggleQuotePrefixRange(start, end);
    },
  });

  const insertQuoteIntoCompose = (text: string) => {
    const el = inputRef.current;
    if (!el) return;
    const quotedBlock = text
      .split('\n')
      .map((line) => (line.startsWith(QUOTE_PREFIX) ? line : `${QUOTE_PREFIX}${line}`))
      .join('\n');
    const newValue = input.length === 0 ? quotedBlock : `${quotedBlock}\n${input}`;
    const caret = input.length === 0 ? quotedBlock.length : quotedBlock.length + 1;
    setInput(newValue);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
      updateQuoteButtonActive(newValue, caret);
    });
  };

  const chatSelectionToolbar = useFloatingSelectionToolbar({
    containerRef: chatMessagesRef,
    resubscribeKey: channel?.id,
    keyupTarget: 'document',
    getSelectionInfo: () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      if (!chatMessagesRef.current?.contains(range.commonAncestorContainer)) return null;
      const text = sel.toString();
      if (text.trim().length === 0) return null;
      const rect = range.getBoundingClientRect();
      return { text, x: rect.right, y: rect.bottom + 8 };
    },
    onConfirm: (text) => {
      insertQuoteIntoCompose(text);
      window.getSelection()?.removeAllRanges();
    },
  });

  // Which message is open in the inline editor; the edit session's own state
  // (draft value, mentions, pickers) lives inside <MessageRow>'s MessageEditor.
  const [editingId, setEditingId] = useState<string | null>(null);

  const saveEdit = async (messageId: string, content: string) => {
    if (!channel || !content) return;
    const original = messages.find((m) => m.id === messageId);
    if (original && content === original.content) {
      setEditingId(null);
      return;
    }
    try {
      const updated = await apiService.updateMessage(channel.id, messageId, content) as Message;
      updateMessage(messageId, updated);
      setEditingId(null);
    } catch (err) {
      logger.error('Failed to update message:', err, { module: 'chat' });
      setSendError(apiErrorText(err, t));
      setTimeout(() => setSendError(null), 5000);
    }
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const confirmDelete = async () => {
    const messageId = confirmDeleteId;
    setConfirmDeleteId(null);
    if (!channel || !messageId) return;
    try {
      await apiService.deleteMessage(channel.id, messageId);
      removeMessage(messageId);
    } catch (err) {
      // The message is already gone server-side (deleted from another
      // device/tab, or its own delete WS event just hasn't reached this
      // client yet) — the end state the user wanted is already true, so
      // just drop it locally instead of logging a "bug" that isn't one.
      if (err instanceof ApiError && err.code === 'message_not_found') {
        removeMessage(messageId);
        return;
      }
      logger.error('Failed to delete message:', err, { module: 'chat' });
    }
  };

  if (!channel) {
    return (
      <main className="chat-area">
        <div className="chat-header">
          {onMobileBack && (
            <button type="button" className="chat-back-btn" onClick={onMobileBack} aria-label={t('chat.back')}>
              <ChevronLeft size={18} strokeWidth={1.8} />
            </button>
          )}
        </div>
        <div className="chat-welcome">
          <h2>{t('chat.welcomeTitle')}</h2>
          <p>{t('chat.welcomeSubtitle')}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="chat-area">
      <div className="chat-header">
        {onMobileBack && (
          <button type="button" className="chat-back-btn" onClick={onMobileBack} aria-label={t('chat.back')}>
            <ChevronLeft size={18} strokeWidth={1.8} />
          </button>
        )}
        <Hash size={17} strokeWidth={1.8} className="chat-header-hash" />
        <h3 className="chat-header-name">{channel.name}</h3>
        <div className="chat-header-actions">
          {onJoinVoice && (
            <button
              type="button"
              className={`chat-voice-btn${callChannelId === channel.id ? ' is-in-call' : ''}`}
              onClick={() => {
                if (callChannelId === channel.id) return;
                onJoinVoice(channel);
              }}
              disabled={callChannelId === channel.id}
              title={
                callChannelId === channel.id
                  ? t('call.inThisCall')
                  : callChannelId
                    ? t('call.goToCall')
                    : t('call.joinVoice')
              }
            >
              <Headphones size={16} strokeWidth={1.8} />
              <span>
                {callChannelId === channel.id
                  ? t('call.inThisCall')
                  : callChannelId
                    ? t('call.goToCall')
                    : t('call.joinVoice')}
              </span>
            </button>
          )}
          <button
            type="button"
            className={`chat-search-btn${searchOpen ? ' is-active' : ''}`}
            onClick={() => setSearchOpen((open) => !open)}
            aria-label={t('chat.searchMessages')}
            title={t('chat.searchHint')}
          >
            <Search size={17} strokeWidth={1.8} />
          </button>
          {onShowCall && (
            <button type="button" className="chat-call-btn" onClick={onShowCall} aria-label={t('call.showCall')} title={t('call.showCall')}>
              <Mic size={17} strokeWidth={1.8} />
            </button>
          )}
          {onShowMembers && (
            <button type="button" className="chat-members-btn" onClick={onShowMembers} aria-label={t('chat.members')} title={t('chat.members')}>
              <Users size={17} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>

      <div className="chat-messages" ref={chatMessagesRef}>
        {loading ? (
          Array.from({ length: 6 }, (_, i) => (
            <div className="chat-skel-row" key={i} aria-hidden="true">
              <div className="chat-skel-avatar" />
              <div>
                <div className="chat-skel-line chat-skel-line-short" />
                <div className="chat-skel-line chat-skel-line-long" />
              </div>
            </div>
          ))
        ) : messages.length === 0 ? (
          <div className="chat-welcome-intro">
            <h1>{t('chat.emptyChannelTitle', { channel: channel.name })}</h1>
            <p>{t('chat.emptyChannelSubtitle', { channel: channel.name })}</p>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => {
              const prevMsg = messages[idx - 1];
              const msgDate = new Date(msg.created_at);
              const dayChanged = !prevMsg || !isSameCalendarDay(msgDate, new Date(prevMsg.created_at));
              const isOwn = msg.user_id === user?.id;
              const continuation = !dayChanged && isContinuation(prevMsg, msg);
              // Username/avatar: server member list first (kept live via
              // user_updated WS events, see AppPage), then the per-message
              // fetch cache as fallback for authors who left the server.
              const member = !isOwn ? members.find((m) => m.user_id === msg.user_id) : undefined;
              const cached = !isOwn ? userCache.get(msg.user_id) : undefined;
              const displayName = isOwn ? user!.username : (member?.username ?? cached?.username ?? msg.user_id.slice(0, 8));
              const avatarUrl = isOwn ? user?.avatar_url : (member?.avatar_url ?? cached?.avatar_url);
              return (
                <Fragment key={msg.id}>
                  {dayChanged && <DayDivider label={formatFullDate(msgDate)} />}
                  <MessageRow
                    msg={msg}
                    isOwn={isOwn}
                    isContinuation={continuation}
                    displayName={displayName}
                    avatarUrl={avatarUrl}
                    isEditing={editingId === msg.id}
                    highlighted={highlightedId === msg.id}
                    entered={enteredIds.has(msg.id)}
                    members={members}
                    currentUserId={user?.id}
                    canMentionEveryone={canMentionEveryone}
                    onStartEdit={() => setEditingId(msg.id)}
                    onCancelEdit={() => setEditingId(null)}
                    onSaveEdit={(content) => saveEdit(msg.id, content)}
                    onDelete={() => setConfirmDeleteId(msg.id)}
                    onQuote={() => insertQuoteIntoCompose(msg.content)}
                  />
                </Fragment>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {sendError && (
        <div className="chat-error-toast">
          {sendError}
        </div>
      )}

      <div className="chat-input">
        <div className="chat-input-toolbar">
          <button
            type="button"
            className={`toolbar-btn${caretInQuoteLine ? ' active' : ''}`}
            aria-pressed={caretInQuoteLine}
            aria-label={t('chat.quote')}
            title={t('chat.quote')}
            onClick={toggleQuotePrefix}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>
          </button>
          <button type="button" className="toolbar-btn" aria-label={t('chat.bold')} title={t('chat.bold')} onClick={() => composeWrap('**')}>
            <strong className="toolbar-txt">B</strong>
          </button>
          <button type="button" className="toolbar-btn" aria-label={t('chat.italic')} title={t('chat.italic')} onClick={() => composeWrap('*')}>
            <em className="toolbar-txt">I</em>
          </button>
          <button type="button" className="toolbar-btn" aria-label={t('chat.underline')} title={t('chat.underline')} onClick={() => composeWrap('__')}>
            <u className="toolbar-txt">U</u>
          </button>
          <button type="button" className="toolbar-btn" aria-label={t('chat.link')} title={t('chat.link')} onClick={() => setLinkOpen(true)}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </button>
          <button type="button" className="toolbar-btn" aria-label={t('chat.numberedList')} title={t('chat.numberedList')} onClick={composeNumbered}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h12"/><path d="M4 12h12"/><path d="M4 18h12"/><path d="M15 7.5l2.5-2.5 1.5 1.5L17.5 9z"/><path d="M15 14l2.5-2.5 1.5 1.5L17.5 15.5z"/><path d="M15 20.5l2.5-2.5 1.5 1.5L17.5 22z"/></svg>
          </button>
          <button type="button" className="toolbar-btn" aria-label={t('chat.bulletedList')} title={t('chat.bulletedList')} onClick={composeBullet}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>
          </button>
          <button type="button" className={`toolbar-btn${stickerPickerOpen ? ' active' : ''}`} aria-label={t('chat.stickers')} title={t('chat.stickers')} onClick={() => setStickerPickerOpen((open) => !open)}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M12 3a9 9 0 0 1 9 9"/><path d="M21 12h-4l-2 2-2-2"/></svg>
          </button>
          <button type="button" className={`toolbar-btn${emojiPickerOpen ? ' active' : ''}`} aria-label={t('chat.emoji')} title={t('chat.emoji')} onClick={() => setEmojiPickerOpen((open) => !open)}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleComposeChange}
            onKeyDown={handleComposeKeyDown}
            onPaste={handleComposePaste}
            onSelect={() => updateQuoteButtonActive()}
            onClick={() => updateQuoteButtonActive()}
            onKeyUp={() => updateQuoteButtonActive()}
            placeholder={t('chat.messagePlaceholder', { channel: channel.name })}
            maxLength={2000}
            rows={1}
          />
          <MentionDropdown mention={composeMention} />
        </form>
        {emojiPickerOpen && (
          <EmojiPicker
            onSelect={(e) => { insertAtCaret(composeTarget, e); setEmojiPickerOpen(false); }}
            onClose={() => setEmojiPickerOpen(false)}
          />
        )}
        {stickerPickerOpen && (
          <StickerPicker
            stickers={serverStickers}
            onSelect={sendSticker}
            onClose={() => setStickerPickerOpen(false)}
            onManage={canManageStickers ? () => setStickerManagerOpen(true) : undefined}
          />
        )}
      </div>

      {composeSelectionToolbar.visible && (
        <FloatingQuoteButton
          x={composeSelectionToolbar.x}
          y={composeSelectionToolbar.y}
          onConfirm={composeSelectionToolbar.confirm}
        />
      )}
      {chatSelectionToolbar.visible && (
        <FloatingQuoteButton
          x={chatSelectionToolbar.x}
          y={chatSelectionToolbar.y}
          onConfirm={chatSelectionToolbar.confirm}
        />
      )}
      {searchOpen && (
        <MessageSearch
          channel={channel}
          onJumpToMessage={jumpToMessage}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {historyMode && (
        <button type="button" className="chat-jump-btn" onClick={backToLatest}>
          <ArrowDown size={16} strokeWidth={1.8} />
          <span>{t('chat.jumpToLatest')}</span>
        </button>
      )}
      <LinkDialog
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        onInsert={insertLink}
      />
      {stickerManagerOpen && channel && (
        <StickerManager
          serverId={channel.server_id}
          onClose={() => { setStickerManagerOpen(false); setStickerPickerOpen(false); }}
          onStickersChanged={refreshStickers}
        />
      )}
      <ConfirmModal
        open={confirmDeleteId !== null}
        title={t('chat.deleteTitle')}
        body={t('chat.deleteBody')}
        confirmLabel={t('common.delete')}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </main>
  );
}
