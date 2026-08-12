import { useState, useEffect, useRef, useCallback, type FormEvent, type KeyboardEvent, type ChangeEvent, type ClipboardEvent } from 'react';
import type { RefObject } from 'react';
import { useMessageStore } from '@/stores/messageStore';
import { LinkDialog } from '@/components/LinkDialog';
import { EmojiPicker } from '@/components/EmojiPicker';
import { StickerPicker } from '@/components/StickerPicker';
import { StickerManager } from '@/components/StickerManager';
import { toggleQuote, toggleBullet, toggleNumbered, toggleWrap, type LineToggle } from '@/utils/textTransforms';
import { isUnsafeUrl } from '@/utils/markdown';
import type { Message } from '@/types';
import { apiService, apiErrorText, resolveUploadUrl } from '@/services/api';
import { wsService } from '@/services/websocket';
import { audioService } from '@/services/audio';
import { useServerStore } from '@/stores/serverStore';
import { tokenizeMentions, LEGACY_ROLE_KEYS } from '@/utils/mentions';
import { logger } from '@/utils/logger';
import { collectUnresolvedUserIds } from '@/utils/userCache';
import { useMentionAutocomplete } from '@/hooks/useMentionAutocomplete';
import { can, PERMISSIONS } from '@/utils/permissions';
import { useFloatingSelectionToolbar } from '@/hooks/useFloatingSelectionToolbar';
import { MessageSearch } from '@/components/MessageSearch';
import { Avatar } from '@/components/Avatar';
import { DayDivider } from '@/components/DayDivider';
import type { Channel, User, MemberWithUser } from '@/types';
import type { Sticker } from '@/types';
import { useT, useDateFormat, isSameCalendarDay, type TFunc } from '@/i18n';
import { Fragment, type ReactNode } from 'react';
import { parseInline, blockify, normalizeLinkHref, type MdInlineNode } from '@/utils/markdown';
import './ChatArea.css';

interface ChatAreaProps {
  channel: Channel | null;
  user: User | null;
  onMobileBack?: () => void;
  onShowMembers?: () => void;
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

function renderMessageContent(content: string, members: MemberWithUser[], t: TFunc, currentUserId?: string) {
  return tokenizeMentions(content).map((token, i) => {
    if (token.type === 'text') {
      return token.value;
    }
    if (token.type === 'role') {
      return (
        <span key={i} className="mention mention-role">
          @{t(LEGACY_ROLE_KEYS[token.value])}
        </span>
      );
    }
    if (token.type === 'everyone') {
      return (
        <span key={i} className="mention mention-everyone">
          @everyone
        </span>
      );
    }
    const member = members.find((m) => m.user_id === token.value);
    const isSelf = token.value === currentUserId;
    return (
      <span key={i} className={`mention${isSelf ? ' mention-self' : ''}`}>
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
        return <span key={i} className="message-quote">{renderInlineNodes(parseInline(b.text), members, t, currentUserId)}</span>;
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

function FloatingQuoteButton({ x, y, onConfirm }: { x: number; y: number; onConfirm: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className="floating-quote-btn"
      style={{ left: x, top: y }}
      aria-label={t('chat.quote')}
      title={t('chat.quote')}
      onMouseDown={(e) => {
        e.preventDefault();
        onConfirm();
      }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>
    </button>
  );
}

function insertEmojiAtCaret(el: HTMLTextAreaElement, setValue: (v: string) => void, emoji: string) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const next = el.value.slice(0, start) + emoji + el.value.slice(end);
  setValue(next);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(start + emoji.length, start + emoji.length);
  });
}

export function ChatArea({ channel, user, onMobileBack, onShowMembers }: ChatAreaProps) {
  const t = useT();
  const { formatTime, formatFullDate } = useDateFormat();
  const { messages, setMessages, addMessage, updateMessage, removeMessage } = useMessageStore();
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
    editMention.reset();
    setCaretInQuoteLine(false);
    setSearchOpen(false);
    setHistoryMode(false);
    setHighlightedId(null);
  }, [channel?.id]);

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

  const applyRangeToggle = (
    value: string,
    setValue: (v: string) => void,
    ref: RefObject<HTMLTextAreaElement | null>,
    fn: (v: string, s: number, e: number) => LineToggle,
  ) => {
    const el = ref.current;
    if (!el) return;
    const s = el.selectionStart ?? value.length;
    const e = el.selectionEnd ?? value.length;
    const r = fn(value, s, e);
    setValue(r.value);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.start, r.end);
    });
  };

  const wrapSelection = (
    value: string,
    setValue: (v: string) => void,
    ref: RefObject<HTMLTextAreaElement | null>,
    marker: string,
  ) => {
    const el = ref.current;
    if (!el) return;
    const s = el.selectionStart ?? value.length;
    const e = el.selectionEnd ?? value.length;
    const r = toggleWrap(value, s, e, marker);
    setValue(r.value);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(r.start, r.end);
    });
  };

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

  const composeWrap = (marker: string) => wrapSelection(input, setInput, inputRef, marker);
  const composeBullet = () => applyRangeToggle(input, setInput, inputRef, toggleBullet);
  const composeNumbered = () => applyRangeToggle(input, setInput, inputRef, toggleNumbered);

  const editWrap = (marker: string) => wrapSelection(editValue, setEditValue, editInputRef, marker);
  const editBullet = () => applyRangeToggle(editValue, setEditValue, editInputRef, toggleBullet);
  const editNumbered = () => applyRangeToggle(editValue, setEditValue, editInputRef, toggleNumbered);

  const [linkTarget, setLinkTarget] = useState<'compose' | 'edit' | null>(null);
  const openLinkFor = (target: 'compose' | 'edit') => setLinkTarget(target);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [editEmojiPickerOpen, setEditEmojiPickerOpen] = useState(false);

  const insertLink = (label: string, url: string) => {
    const isEdit = linkTarget === 'edit';
    const value = isEdit ? editValue : input;
    const ref = isEdit ? editInputRef : inputRef;
    const setValue = isEdit ? setEditValue : setInput;
    const el = ref.current;
    if (!el) return;
    const text = label || url;
    const token = `[${text}](${url})`;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    setValue(next);
    setLinkTarget(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const editMention = useMentionAutocomplete({
    value: editValue,
    setValue: setEditValue,
    inputRef: editInputRef,
    members,
    canMentionEveryone,
  });

  useEffect(() => {
    const el = editInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [editValue, editingId]);

  const toggleEditQuotePrefixRange = (start: number, end: number) => {
    const el = editInputRef.current;
    const r = toggleQuote(editValue, start, end);
    setEditValue(r.value);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(r.start, r.end);
    });
  };

  const editSelectionToolbar = useFloatingSelectionToolbar({
    containerRef: editInputRef,
    resubscribeKey: editingId,
    getSelectionInfo: (e) => {
      const el = editInputRef.current;
      const start = el?.selectionStart;
      const end = el?.selectionEnd;
      if (!el || start == null || end == null || start === end) return null;
      const text = el.value.slice(start, end);
      if (e) return { text, x: e.clientX, y: e.clientY + 16 };
      const rect = el.getBoundingClientRect();
      return { text, x: rect.left + 24, y: rect.top - 8 };
    },
    onConfirm: () => {
      const el = editInputRef.current;
      const start = el?.selectionStart;
      const end = el?.selectionEnd;
      if (!el || start == null || end == null) return;
      toggleEditQuotePrefixRange(start, end);
    },
  });

  const startEdit = (msg: Message) => {
    if (msg.sticker_id) return;
    setEditingId(msg.id);
    setEditValue(msg.content);
    editMention.reset();
  };

  const cancelEdit = () => {
    if (linkTarget === 'edit') return;
    setEditingId(null);
    setEditValue('');
    editMention.reset();
  };

  const saveEdit = async (messageId: string) => {
    if (!channel || !editValue.trim()) return;
    const original = messages.find((m) => m.id === messageId);
    if (original && editValue.trim() === original.content) {
      cancelEdit();
      return;
    }
    try {
      const updated = await apiService.updateMessage(channel.id, messageId, editValue.trim()) as Message;
      updateMessage(messageId, updated);
      cancelEdit();
    } catch (err) {
logger.error('Failed to update message:', err, { module: 'chat' });
      setSendError(apiErrorText(err, t));
      setTimeout(() => setSendError(null), 5000);
    }
  };

  const handleEditKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>, messageId: string) => {
    if (editMention.handleKeyDown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveEdit(messageId);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  const handleDelete = async (messageId: string) => {
    if (!channel) return;
    if (!window.confirm(t('chat.deleteConfirm'))) return;
    try {
      await apiService.deleteMessage(channel.id, messageId);
      removeMessage(messageId);
    } catch (err) {
      logger.error('Failed to delete message:', err, { module: 'chat' });
    }
  };

  if (!channel) {
    return (
      <main className="chat-area">
        <div className="chat-header chat-header--empty">
          {onMobileBack && (
            <button className="mobile-back-btn" onClick={onMobileBack} aria-label={t('chat.back')}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          )}
        </div>
        <div className="chat-empty">
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
          <button className="mobile-back-btn" onClick={onMobileBack} aria-label={t('chat.back')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        )}
        <span className="channel-hash">#</span>
        <h3>{channel.name}</h3>
        <button
          type="button"
          className={`chat-search-btn${searchOpen ? ' active' : ''}`}
          onClick={() => setSearchOpen((open) => !open)}
          aria-label={t('chat.searchMessages')}
          title={t('chat.searchHint')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>
        {onShowMembers && (
          <button className="mobile-members-btn" onClick={onShowMembers} aria-label={t('chat.members')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </button>
        )}
      </div>

      <div className="chat-messages" ref={chatMessagesRef}>
        {messages.length === 0 ? (
          <div className="welcome-message">
            <h1>{t('chat.emptyChannelTitle', { channel: channel.name })}</h1>
            <p>{t('chat.emptyChannelSubtitle', { channel: channel.name })}</p>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => {
              const prevMsg = messages[idx - 1];
              const msgDate = new Date(msg.created_at);
              const dayChanged =
                !prevMsg ||
                !isSameCalendarDay(msgDate, new Date(prevMsg.created_at));
              const isFromMe = msg.user_id === user?.id;
              const isCompact =
                !!prevMsg &&
                !dayChanged &&
                prevMsg.user_id === msg.user_id &&
                new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() < 420000;

              // Username/avatar: server member list first (kept live via
              // user_updated WS events, see AppPage), then the per-message
              // fetch cache as fallback for authors who left the server.
              const member = !isFromMe ? members.find((m) => m.user_id === msg.user_id) : undefined;
              const cached = !isFromMe ? userCache.get(msg.user_id) : undefined;
              const displayName = isFromMe
                ? user!.username
                : (member?.username ?? cached?.username ?? msg.user_id.slice(0, 8));
              const avatarUrl = isFromMe ? user?.avatar_url : (member?.avatar_url ?? cached?.avatar_url);

              const isEdited = msg.updated_at !== msg.created_at;
              const isEditing = editingId === msg.id;

              return (
                <Fragment key={msg.id}>
                  {dayChanged && <DayDivider label={formatFullDate(msgDate)} />}
                  <div
                    data-message-id={msg.id}
                    className={`message ${isCompact ? 'compact' : ''} ${isFromMe ? 'self' : 'other'}${highlightedId === msg.id ? ' jump-highlight' : ''}`}
                  >
                  {!isCompact && !isFromMe && (
                    <Avatar url={avatarUrl} username={displayName} className="message-avatar" />
                  )}
                  <div className="message-content">
                    {!isCompact && !isFromMe && (
                      <div className="message-header">
                        <span className="message-author">{displayName}</span>
                        <span className="message-timestamp">
                          {formatTime(new Date(msg.created_at))}
                          {isEdited && t('chat.edited')}
                        </span>
                      </div>
                    )}
                    {!isCompact && isFromMe && (
                      <div className="message-header self">
                        <span className="message-timestamp">
                          {formatTime(new Date(msg.created_at))}
                          {isEdited && t('chat.edited')}
                        </span>
                        <span className="message-author">{displayName}</span>
                      </div>
                    )}
                    {isEditing ? (
                      <div className="message-edit-wrapper">
                        <textarea
                          ref={editInputRef}
                          className="message-edit-input"
                          value={editValue}
                          onChange={editMention.handleChange}
                          onKeyDown={(e) => handleEditKeyDown(e, msg.id)}
                          onBlur={cancelEdit}
                          maxLength={2000}
                          rows={1}
                          autoFocus
                        />
                        <div className="chat-input-toolbar">
                          <button type="button" onMouseDown={(e) => e.preventDefault()} className="toolbar-btn" aria-label={t('chat.bold')} title={t('chat.bold')} onClick={() => editWrap('**')}><strong className="toolbar-txt">B</strong></button>
                          <button type="button" onMouseDown={(e) => e.preventDefault()} className="toolbar-btn" aria-label={t('chat.italic')} title={t('chat.italic')} onClick={() => editWrap('*')}><em className="toolbar-txt">I</em></button>
                          <button type="button" onMouseDown={(e) => e.preventDefault()} className="toolbar-btn" aria-label={t('chat.underline')} title={t('chat.underline')} onClick={() => editWrap('__')}><u className="toolbar-txt">U</u></button>
                          <button type="button" onMouseDown={(e) => e.preventDefault()} className="toolbar-btn" aria-label={t('chat.link')} title={t('chat.link')} onClick={() => openLinkFor('edit')}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                          </button>
                          <button type="button" onMouseDown={(e) => e.preventDefault()} className="toolbar-btn" aria-label={t('chat.numberedList')} title={t('chat.numberedList')} onClick={editNumbered}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h12"/><path d="M4 12h12"/><path d="M4 18h12"/><path d="M15 7.5l2.5-2.5 1.5 1.5L17.5 9z"/><path d="M15 14l2.5-2.5 1.5 1.5L17.5 15.5z"/><path d="M15 20.5l2.5-2.5 1.5 1.5L17.5 22z"/></svg>
                          </button>
                          <button type="button" onMouseDown={(e) => e.preventDefault()} className="toolbar-btn" aria-label={t('chat.bulletedList')} title={t('chat.bulletedList')} onClick={editBullet}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>
                          </button>
                          <button type="button" onMouseDown={(e) => e.preventDefault()} className={`toolbar-btn${editEmojiPickerOpen ? ' active' : ''}`} aria-label={t('chat.emoji')} title={t('chat.emoji')} onClick={() => setEditEmojiPickerOpen((open) => !open)}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                          </button>
                        </div>
                        {editMention.mentionQuery !== null && editMention.mentionEntries.length > 0 && (
                          <ul className="mention-dropdown">
                            {editMention.mentionEntries.map((entry, i) => (
                              <li
                                key={editMention.entryKey(entry)}
                                className={i === editMention.mentionIndex ? 'active' : ''}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  editMention.selectEntry(entry);
                                }}
                              >
                                @{entry.label}
                              </li>
                            ))}
                          </ul>
                        )}
                        {editEmojiPickerOpen && (
                          <EmojiPicker
                            onSelect={(e) => { insertEmojiAtCaret(editInputRef.current!, setEditValue, e); setEditEmojiPickerOpen(false); }}
                            onClose={() => setEditEmojiPickerOpen(false)}
                          />
                        )}
                      </div>
                    ) : msg.sticker_id && msg.sticker ? (
                      <div className="message-sticker-wrap">
                        <img className="message-sticker" src={resolveUploadUrl(msg.sticker.image_url)} alt={msg.sticker.name} />
                      </div>
                    ) : msg.sticker_id ? (
                      <div className="message-text">{t('chat.stickerRemoved')}</div>
                    ) : (
                      <div className="message-text">{renderMessageBody(msg.content, members, t, user?.id)}</div>
                    )}
                  </div>
                  {!isCompact && isFromMe && (
                    <Avatar url={avatarUrl} username={displayName} className="message-avatar self" />
                  )}
                  {isFromMe && !isEditing && (
                    <div className="message-actions">
                      {!msg.sticker_id && (
                      <button
                        type="button"
                        className="message-action-btn"
                        aria-label={t('common.edit')}
                        onClick={() => startEdit(msg)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                      </button>
                      )}
                      <button
                        type="button"
                        className="message-action-btn message-action-btn--danger"
                        aria-label={t('common.delete')}
                        onClick={() => handleDelete(msg.id)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </div>
                  )}
                  </div>
                </Fragment>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {sendError && (
        <div className="error-toast">
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
          <button type="button" className="toolbar-btn" aria-label={t('chat.link')} title={t('chat.link')} onClick={() => openLinkFor('compose')}>
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
          {composeMention.mentionQuery !== null && composeMention.mentionEntries.length > 0 && (
            <ul className="mention-dropdown">
              {composeMention.mentionEntries.map((entry, i) => (
                <li
                  key={composeMention.entryKey(entry)}
                  className={i === composeMention.mentionIndex ? 'active' : ''}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    composeMention.selectEntry(entry);
                  }}
                >
                  @{entry.label}
                </li>
              ))}
            </ul>
          )}
        </form>
        {emojiPickerOpen && (
          <EmojiPicker
            onSelect={(e) => { insertEmojiAtCaret(inputRef.current!, setInput, e); setEmojiPickerOpen(false); }}
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
      {editSelectionToolbar.visible && (
        <FloatingQuoteButton
          x={editSelectionToolbar.x}
          y={editSelectionToolbar.y}
          onConfirm={editSelectionToolbar.confirm}
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
        <button type="button" className="back-to-latest-btn" onClick={backToLatest}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
          <span>{t('chat.jumpToLatest')}</span>
        </button>
      )}
      <LinkDialog
        open={linkTarget !== null}
        onClose={() => setLinkTarget(null)}
        onInsert={insertLink}
      />
      {stickerManagerOpen && channel && (
        <StickerManager
          serverId={channel.server_id}
          onClose={() => { setStickerManagerOpen(false); setStickerPickerOpen(false); }}
          onStickersChanged={refreshStickers}
        />
      )}
    </main>
  );
}
