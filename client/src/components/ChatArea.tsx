import { Fragment, useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { ArrowDown, ChevronLeft, Hash, Headphones, Mic, Plus, Search, Users } from 'lucide-react';
import { useMessageStore } from '@/stores/messageStore';
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
import { MessageSearch } from '@/components/MessageSearch';
import { MessageRow } from '@/components/MessageRow';
import { Composer, type ComposerHandle } from '@/components/Composer';
import { FloatingQuoteButton } from '@/components/FloatingQuoteButton';
import { DayDivider } from '@/components/DayDivider';
import { ConfirmModal } from '@/components/ConfirmModal';
import type { Channel, User } from '@/types';
import type { Sticker } from '@/types';
import { useT, useDateFormat, isSameCalendarDay } from '@/i18n';
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
}

export function ChatArea({ channel, user, onMobileBack, onShowMembers, onJoinVoice, onShowCall, onCreateServer }: ChatAreaProps) {
  const callChannelId = useCallStore((s) => s.callChannelId);
  const t = useT();
  const { formatFullDate } = useDateFormat();
  const { messages, loading, setMessages, addMessage, updateMessage, removeMessage } = useMessageStore();
  const { members, currentServer } = useServerStore();
  const servers = useServerStore((s) => s.servers);
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyMode, setHistoryMode] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
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

  useEffect(() => {
    if (historyMode) return; // в режиме просмотра истории не утаскиваем вниз
    scrollToBottom();
  }, [messages, historyMode]);

  useEffect(() => {
    setEditingId(null);
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

  /** Composer's send callback. `false` keeps the user's draft in the field. */
  const sendMessage = async (content: string): Promise<boolean> => {
    if (!channel || !user) return false;
    try {
      const msg = await apiService.createMessage(channel.id, content) as Message;
      addMessage(msg);
      return true;
    } catch (err) {
      logger.error('Failed to send message:', err, { module: 'chat' });
      showSendError(err);
      return false;
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
        {servers.length === 0 ? (
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
              <button type="button" className="btn btn-primary" onClick={() => onCreateServer?.()}>
                {t('server.create')}
              </button>
            }
          />
        ) : (
          <ChatEmptyCard title={t('chat.welcomeTitle')} body={t('chat.welcomeSubtitle')} />
        )}
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
      {stickerManagerOpen && channel && (
        <StickerManager
          serverId={channel.server_id}
          onClose={() => setStickerManagerOpen(false)}
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
