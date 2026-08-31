import { Fragment, useState, useEffect, useRef, useCallback, type DragEvent, type ReactNode } from 'react';
import { ArrowDown, ChevronLeft, Hash, Headphones, Mic, Plus, Search, Users } from 'lucide-react';
import { useMessageStore, type ChatMessage } from '@/stores/messageStore';
import { useUnreadStore, firstUnreadId } from '@/stores/unreadStore';
import { StickerManager } from '@/components/StickerManager';
import type { Message } from '@/types';
import { apiService, apiErrorText, ApiError } from '@/services/api';
import { wsService } from '@/services/websocket';
import { audioService } from '@/services/audio';
import { useServerStore } from '@/stores/serverStore';
import { useCallStore } from '@/stores/callStore';
import { logger } from '@/utils/logger';
import { collectUnresolvedUserIds } from '@/utils/userCache';
import { isContinuation } from '@/utils/messageGroups';
import { can, PERMISSIONS } from '@/utils/permissions';
import { useFloatingSelectionToolbar } from '@/hooks/useFloatingSelectionToolbar';
import { isBlockingOverlayOpen } from '@/hooks/useModalFocus';
import { usePaletteStore } from '@/stores/paletteStore';
import { MessageSearch } from '@/components/MessageSearch';
import { MessageRow } from '@/components/MessageRow';
import { Composer, type ComposerHandle } from '@/components/Composer';
import { FloatingQuoteButton } from '@/components/FloatingQuoteButton';
import { DayDivider } from '@/components/DayDivider';
import { ConfirmModal } from '@/components/ConfirmModal';
import { VoiceBanner } from '@/components/VoiceBanner';
import { MediaLightbox, pickLightboxMedia } from '@/components/MediaLightbox';
import { useAttachmentUpload } from '@/hooks/useAttachmentUpload';
import type { Attachment, Channel, User } from '@/types';
import type { Sticker } from '@/types';
import { useT, useTp, useDateFormat, isSameCalendarDay } from '@/i18n';
import './ChatArea.css';

// Shared card recipe for the three ChatArea empty states (board 2a): quiet
// channel, no servers, servers-exist-but-no-channel-selected. `tile` is the
// 56px icon tile (or the no-servers 3-tile strip) — omitted for the plain
// "pick a channel" variant.
function ChatEmptyCard({ tile, title, body, action }: { tile?: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="chat-empty-card">
      {tile}
      <h2 className="chat-empty-title">{title}</h2>
      <p className="chat-empty-body">{body}</p>
      {action}
    </div>
  );
}

interface ChatAreaProps {
  channel: Channel | null;
  user: User | null;
  onMobileBack?: () => void;
  onShowMembers?: () => void;
  onJoinVoice?: (channel: Channel) => void;
  onShowCall?: () => void;
  onCreateServer?: () => void;
  onFindServer?: () => void;
  voiceParticipants?: Map<string, string[]>;
}

export function ChatArea({ channel, user, onMobileBack, onShowMembers, onJoinVoice, onShowCall, onCreateServer, onFindServer, voiceParticipants }: ChatAreaProps) {
  const callChannelId = useCallStore((s) => s.callChannelId);
  const t = useT();
  const tp = useTp();
  const { formatFullDate } = useDateFormat();
  const { messages, loading, setMessages, addMessage, updateMessage, replaceMessage, removeMessage } = useMessageStore();
  const { members, currentServer } = useServerStore();
  const servers = useServerStore((s) => s.servers);
  const serversLoaded = useServerStore((s) => s.serversLoaded);
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pendingSeqRef = useRef(0);
  const composerRef = useRef<ComposerHandle>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchSeed, setSearchSeed] = useState<{ id: number; query: string } | null>(null);
  const paletteCommand = usePaletteStore((s) => s.command);
  const clearPaletteCommand = usePaletteStore((s) => s.clearCommand);
  const [historyMode, setHistoryMode] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [stickerManagerOpen, setStickerManagerOpen] = useState(false);
  const [serverStickers, setServerStickers] = useState<Sticker[]>([]);

  // Drag-and-drop is a column-level concern (the scrim covers the whole chat
  // area, not just the composer), so ChatArea calls the upload hook too. The
  // hook holds no local state of its own — a stable-reference zustand
  // selector plus useCallback wrappers over store actions — so this and
  // Composer's call are two views of one store, and nothing has to be
  // drilled between them. Cost: ChatArea re-renders on each progress tick
  // even though it only needs `addFiles`. Accepted, not fixed.
  const uploads = useAttachmentUpload(channel?.id);

  // Counter, not a boolean: dragleave fires from every child element the
  // pointer crosses inside the chat, and a boolean would make the overlay
  // flicker.
  const [dragDepth, setDragDepth] = useState(0);

  const handleDragEnter = (e: DragEvent<HTMLElement>) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    setDragDepth((d) => d + 1);
  };

  const handleDragOver = (e: DragEvent<HTMLElement>) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  };

  const handleDragLeave = () => setDragDepth((d) => Math.max(0, d - 1));

  const handleDrop = (e: DragEvent<HTMLElement>) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    setDragDepth(0);
    uploads.addFiles(e.dataTransfer.files);
  };

  // A drag left in flight when the user switches channels would strand the
  // scrim over the new channel: no dragleave is ever delivered for the
  // unmounted subtree.
  useEffect(() => { setDragDepth(0); }, [channel?.id]);

  /** Which message's media is open fullscreen; mounted once, at column level. */
  const [lightbox, setLightbox] = useState<{ attachments: Attachment[]; index: number } | null>(null);
  useEffect(() => { setLightbox(null); }, [channel?.id]);

  // Канал команд палитры (решение 5): MessageSearch и jumpToMessage живут
  // только здесь, поэтому только два действия палитры доходят через
  // paletteStore, а не прямым колбэком из AppPage.
  useEffect(() => {
    const cmd = paletteCommand;
    if (!cmd) return;
    // Снимаем команду ПЕРВЫМ делом: повторный заход эффекта становится no-op.
    clearPaletteCommand(cmd.id);
    // Канал мог смениться между открытием палитры и ↵ — тогда команда чужая.
    if (!channel || cmd.channelId !== channel.id) return;
    if (cmd.kind === 'chat-search') { setSearchSeed({ id: cmd.id, query: cmd.query }); setSearchOpen(true); }
    else jumpToMessage(cmd.messageId);
  }, [paletteCommand, channel, clearPaletteCommand]);

  // Unread divider anchor (spec §4.4): computed once per channel entry from
  // the persisted mark, then pinned — new messages arriving while the user is
  // in the channel must not move it. Re-entering recomputes from scratch.
  const [unreadAnchorId, setUnreadAnchorId] = useState<string | null>(null);
  const anchorComputedRef = useRef(false);
  useEffect(() => { anchorComputedRef.current = false; setUnreadAnchorId(null); }, [channel?.id]);
  useEffect(() => {
    if (anchorComputedRef.current || loading || !channel || messages.length === 0) return;
    anchorComputedRef.current = true;
    setUnreadAnchorId(firstUnreadId(useUnreadStore.getState().lastRead[channel.id], messages));
  }, [messages, loading, channel]);

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

  useEffect(() => {
    if (historyMode) return; // в режиме просмотра истории не утаскиваем вниз
    scrollToBottom();
  }, [messages, historyMode]);

  // Viewport mark-read: the persisted `lastRead` mark advances whenever the
  // bottom sentinel is visible, but (per the divider-pin behavior above) this
  // never moves the already-computed `unreadAnchorId` while the user stays in
  // the channel. `messagesEndRef` is unconditional in the JSX below — it must
  // exist through the loading skeleton and the empty-channel state too, or
  // this observer attaches to nothing on those entry paths.
  //
  // Deps include `messages`, not just `channel?.id`: IntersectionObserver
  // delivers a spec-guaranteed initial notification as soon as `observe()`
  // is called if the target is already intersecting — which the sentinel
  // usually is, since it's unconditional and the container rarely scrolls
  // it out of view. On a channel switch that notification fires before the
  // new channel's fetch has replaced `useMessageStore`'s `messages`, so a
  // channel_id filter alone would go quiet (no crash, but also no mark) —
  // it needs a fresh `observe()` once the real messages for THIS channel
  // have actually landed, hence re-running this effect on `messages` too.
  // The `m.channel_id === channel.id` filter is the other half: it stops a
  // still-in-flight notification from a just-left channel's stale message
  // list writing into the *new* channel's mark (verified empirically — see
  // task-10-report.md).
  useEffect(() => {
    const sentinel = messagesEndRef.current;
    const root = chatMessagesRef.current;
    if (!sentinel || !root || !channel) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      const msgs = useMessageStore.getState().messages;
      const last = [...msgs].reverse().find((m) => !m.deliveryState && m.channel_id === channel.id);
      if (last) useUnreadStore.getState().markRead(channel.id, last.id, last.created_at);
    }, { root, threshold: 0 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [channel?.id, messages]);

  useEffect(() => {
    setEditingId(null);
    setSearchOpen(false);
    // Иначе стартовавший в канале A запрос из палитры переживает переключение
    // канала и всплывает как initialQuery при следующем РУЧНОМ открытии через
    // кнопку в канале B (тот путь не трогает searchSeed — см. header-кнопку).
    setSearchSeed(null);
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

    // Task 11 Correction 1: `replaceMessage(tempId, serverMsg)` (optimistic
    // send reconciling on the HTTP response) is a same-length array whose id
    // at exactly one position changes — the shape test below reads that as a
    // list replacement and wipes `enteredIds` entirely, which would strip the
    // is-entering class off any OTHER row still mid-fade (e.g. a second
    // message sent moments later). A single-position id swap at unchanged
    // length is a reconciliation, not a replacement: advance the tracking ref
    // and leave `enteredIds` untouched — the reconciled row remounts under
    // its new id (Fragment key={msg.id} below) with no entering class either
    // way, so it always mounts already at full opacity (one deliberate
    // "delivered" pop, not a second fade-in — see task-11 report).
    if (ids.length === prev.length && ids.length > 0) {
      let diffCount = 0;
      for (let i = 0; i < ids.length; i++) {
        if (ids[i] !== prev[i]) {
          diffCount++;
          if (diffCount > 1) break;
        }
      }
      if (diffCount === 1) {
        prevIdsRef.current = ids;
        return;
      }
    }

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
      if (isBlockingOverlayOpen()) return;
      if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f' || e.code === 'KeyF')) {
        e.preventDefault();
        setSearchSeed(null);      // безусловно: клавиатурное открытие — это
        setSearchOpen((o) => !o); // всегда новый ручной поиск, а не повтор
      }                           // запроса из палитры
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

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
      showSendError(err);
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

  const showSendError = (err: unknown) => {
    setSendError(apiErrorText(err, t));
    setTimeout(() => setSendError(null), 5000);
  };

  /**
   * Composer's send callback (Task 11: optimistic). The row is added right
   * away at `deliveryState: 'sending'`; the HTTP response reconciles it in
   * place (`replaceMessage`) or, on failure, flips it to `'failed'` so
   * MessageRow's own chip — not a toast — carries the error and the retry.
   *
   * Final-review fix 1: the chip is only reachable while the row is still in
   * the store. If the user switches channels before the POST rejects, AppPage
   * has already replaced the whole `messages` array, so `updateMessage(tempId)`
   * no-ops against a list that no longer contains it and NO failed row can ever
   * render. Falling back to the toast keeps the pre-M2 floor — a send never
   * fails silently — without reintroducing a toast on the path the chip owns.
   */
  const sendMessage = async (content: string, attachments?: Attachment[]) => {
    if (!channel || !user) return;
    const tempId = `pending-${Date.now()}-${pendingSeqRef.current++}`;
    const now = new Date().toISOString();
    // The attachments are already uploaded, so the optimistic row can render
    // them straight away — and, if the POST fails, the `failed` row still
    // knows its ids so `retrySend` can re-send exactly the same blobs.
    addMessage({
      id: tempId, channel_id: channel.id, user_id: user.id,
      content, created_at: now, updated_at: now, deliveryState: 'sending',
      attachments,
    });
    try {
      const msg = await apiService.createMessage(
        channel.id, content, undefined, attachments?.length ? attachments.map((a) => a.id) : undefined,
      ) as Message;
      replaceMessage(tempId, msg);
    } catch (err) {
      logger.error('Failed to send message:', err, { module: 'chat' });
      const stillThere = useMessageStore.getState().messages.some((m) => m.id === tempId);
      if (stillThere) updateMessage(tempId, { deliveryState: 'failed' });
      else showSendError(err);
    }
  };

  const retrySend = async (msg: ChatMessage) => {
    if (!channel) return;
    // Guards a same-task double-click on the retry chip the same way the
    // composer's submittingRef guards double-Enter (verified empirically:
    // without this, two synchronous clicks fired two real POSTs — a real
    // duplicate persisted server-side even though the UI only ever showed
    // one row, since the second `replaceMessage(msg.id, ...)` silently
    // no-ops once the first response already swapped `msg.id` away). Zustand
    // writes are synchronous (unlike React state), so reading the live store
    // here — not the `msg` closure — sees the first click's 'sending' write
    // immediately, before the second click's handler runs.
    const current = useMessageStore.getState().messages.find((m) => m.id === msg.id);
    if (!current || current.deliveryState !== 'failed') return;
    updateMessage(msg.id, { deliveryState: 'sending' });
    try {
      // Re-send the ids the failed row was carrying, or the retry would
      // quietly drop the user's files and post a bare text message.
      const saved = await apiService.createMessage(
        channel.id, msg.content, undefined,
        msg.attachments?.length ? msg.attachments.map((a) => a.id) : undefined,
      ) as Message;
      replaceMessage(msg.id, saved);
    } catch (err) {
      logger.error('Failed to send message:', err, { module: 'chat' });
      updateMessage(msg.id, { deliveryState: 'failed' });
    }
  };

  const sendSticker = async (sticker: Sticker): Promise<boolean> => {
    if (!channel || !user) return false;
    try {
      const msg = await apiService.createMessage(channel.id, '', sticker.id) as Message;
      addMessage(msg);
      return true;
    } catch (err) {
      showSendError(err);
      return false;
    }
  };

  const insertQuoteIntoCompose = (text: string) => composerRef.current?.insertQuote(text);

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
      showSendError(err);
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
        {!serversLoaded ? null : servers.length === 0 ? (
          <ChatEmptyCard
            tile={
              <div className="chat-empty-tiles">
                <div className="chat-empty-tiles-slot" />
                <div className="chat-empty-tiles-slot is-active">
                  <Plus size={16} strokeWidth={1.8} />
                </div>
                <div className="chat-empty-tiles-slot" />
              </div>
            }
            title={t('chat.noServersTitle')}
            body={t('chat.noServersBody')}
            action={
              <div className="chat-empty-actions">
                <button type="button" className="btn btn-primary" onClick={() => onCreateServer?.()}>
                  {t('server.create')}
                </button>
                {onFindServer && (
                  <button type="button" className="btn btn-secondary" onClick={onFindServer}>
                    {t('chat.haveCode')}
                  </button>
                )}
              </div>
            }
          />
        ) : (
          <ChatEmptyCard title={t('chat.welcomeTitle')} body={t('chat.welcomeSubtitle')} />
        )}
      </main>
    );
  }

  return (
    <main
      className="chat-area"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragDepth > 0 && (
        <div className="chat-drop-overlay">
          <span>{t('chat.dropFilesHere')}</span>
        </div>
      )}
      <div className="chat-header">
        {onMobileBack && (
          <button type="button" className="chat-back-btn" onClick={onMobileBack} aria-label={t('chat.back')}>
            <ChevronLeft size={18} strokeWidth={1.8} />
          </button>
        )}
        <Hash size={17} strokeWidth={1.8} className="chat-header-hash" />
        {/* The document's h1 (M6 T5). The open channel is what the page is
            about, so the persistent header carries the level — NOT
            `.chat-empty-title` (still an h2 at :41), which would either name an
            absence in the no-channel state or produce a SECOND h1 whenever the
            empty card renders inside an open channel.
            BOTH copies below are h1, and that is deliberate: this name is
            rendered twice on purpose (desktop one-liner + mobile two-line
            wrapper) and two `display: none` rules in ChatArea.css hide exactly
            one of them at every viewport — `.chat-header-title` in the base
            block, and `.chat-header > .chat-header-name` inside
            `@media (width <= 768px)`. **Cited by selector on purpose:** the
            line numbers this comment used to give (:377/:381) were already
            wrong before M6 closed — :377 is a brace and :381 is inside an
            unrelated comment. Grep the two selectors; do not trust a number
            here. display:none removes an element from the
            accessibility tree, so precisely one h1 is ever exposed — whereas
            promoting only one copy would leave the OTHER viewport with no h1
            at all. */}
        <h1 className="chat-header-name">{channel.name}</h1>
        {/* Mobile-only two-line title (board 1f): the plain .chat-header-name
            above hides on mobile, this wrapper (hidden on desktop) takes over
            with the channel name plus a server/participants subtitle. */}
        <div className="chat-header-title">
          <h1 className="chat-header-name">{channel.name}</h1>
          <div className="chat-header-sub">
            {currentServer?.name} · {tp('call.participants', members.length)}
          </div>
        </div>
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
            onClick={() => {
              if (searchOpen) { setSearchOpen(false); setSearchSeed(null); }
              else setSearchOpen(true);
            }}
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

      <VoiceBanner
        channelName={channel.name}
        participantIds={voiceParticipants?.get(channel.id) ?? []}
        members={members}
        inThisCall={callChannelId === channel.id}
        onJoin={() => onJoinVoice?.(channel)}
        onShowCall={onShowCall}
      />

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
          <ChatEmptyCard
            tile={
              <div className="chat-empty-tile">
                <Hash size={22} strokeWidth={1.8} />
              </div>
            }
            title={t('chat.quietTitle')}
            body={t('chat.quietBody', { channel: channel.name })}
            action={
              <button type="button" className="btn btn-primary" onClick={() => composerRef.current?.focus()}>
                {t('chat.writeFirst')}
              </button>
            }
          />
        ) : (
          messages.map((msg, idx) => {
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
                {msg.id === unreadAnchorId && (
                  <div className="unread-divider" role="separator" aria-label={t('chat.newMessages')}>
                    <span className="unread-divider-line" />
                    <span className="unread-divider-pill">{t('chat.newMessages')}</span>
                    <span className="unread-divider-line" />
                  </div>
                )}
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
                  onRetry={() => retrySend(msg)}
                  // Client-only row (never reached the server) — no API call,
                  // no confirm modal, just drop it from the store.
                  onDiscard={() => removeMessage(msg.id)}
                  // pickLightboxMedia narrows the row-local index to the
                  // image/video subset and returns null for a non-media
                  // click (a pdf chip) — nothing to open fullscreen.
                  onOpenAttachment={(index) => setLightbox(pickLightboxMedia(msg.attachments ?? [], index))}
                />
              </Fragment>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {sendError && (
        <div className="error-toast">
          {sendError}
        </div>
      )}

      <Composer
        ref={composerRef}
        channel={channel}
        members={members}
        canMentionEveryone={canMentionEveryone}
        onSend={sendMessage}
        serverStickers={serverStickers}
        onSendSticker={sendSticker}
        canManageStickers={canManageStickers}
        onOpenStickerManager={() => setStickerManagerOpen(true)}
      />
      {chatSelectionToolbar.visible && (
        <FloatingQuoteButton
          x={chatSelectionToolbar.x}
          y={chatSelectionToolbar.y}
          onConfirm={chatSelectionToolbar.confirm}
        />
      )}
      {searchOpen && (
        <MessageSearch
          key={searchSeed?.id ?? 0}
          channel={channel}
          initialQuery={searchSeed?.query}
          onJumpToMessage={jumpToMessage}
          onClose={() => { setSearchOpen(false); setSearchSeed(null); }}
        />
      )}
      {historyMode && (
        <button type="button" className="chat-jump-btn" onClick={backToLatest}>
          <ArrowDown size={16} strokeWidth={1.8} />
          <span>{t('chat.jumpToLatest')}</span>
        </button>
      )}
      {stickerManagerOpen && channel && (
        <StickerManager
          serverId={channel.server_id}
          onClose={() => setStickerManagerOpen(false)}
          onStickersChanged={refreshStickers}
        />
      )}
      {/* Portals to <body> itself, so the mount point only decides ownership,
          not stacking. M5.5 T4 closed the overlay contract this comment used
          to record as open: the lightbox now wears `.modal-overlay` and adopts
          useModalFocus, so isBlockingOverlayOpen() DOES see it — which is why
          the Ctrl+Shift+F gate at the top of this file no longer toggles the
          search panel underneath an open lightbox. */}
      {lightbox && (
        <MediaLightbox
          attachments={lightbox.attachments}
          index={lightbox.index}
          onIndexChange={(index) => setLightbox((cur) => (cur ? { ...cur, index } : cur))}
          onClose={() => setLightbox(null)}
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
