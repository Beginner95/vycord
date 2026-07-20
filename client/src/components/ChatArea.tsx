import { useState, useEffect, useRef, type FormEvent, type KeyboardEvent, type ChangeEvent } from 'react';
import { useMessageStore } from '@/stores/messageStore';
import type { Message } from '@/types';
import { apiService } from '@/services/api';
import { wsService } from '@/services/websocket';
import { audioService } from '@/services/audio';
import { useServerStore } from '@/stores/serverStore';
import { tokenizeMentions, roleLabel } from '@/utils/mentions';
import { useMentionAutocomplete } from '@/hooks/useMentionAutocomplete';
import { useFloatingSelectionToolbar } from '@/hooks/useFloatingSelectionToolbar';
import { MessageSearch } from '@/components/MessageSearch';
import type { Channel, User, MemberWithUser } from '@/types';
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

function toggleQuoteLinesInRange(value: string, start: number, end: number) {
  const { lineStart, lineEnd } = lineRangeForSelection(value, start, end);
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const allQuoted = lines.every((line) => line.startsWith(QUOTE_PREFIX));
  const newLines = lines.map((line) => {
    if (allQuoted) return line.slice(QUOTE_PREFIX.length);
    return line.startsWith(QUOTE_PREFIX) ? line : `${QUOTE_PREFIX}${line}`;
  });
  const newBlock = newLines.join('\n');
  const newValue = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
  const delta = newBlock.length - block.length;

  // How far a position within [lineStart, lineEnd] shifts after the toggle: the
  // sum of the per-line length deltas for every line up to and including the
  // line the position sits on. A line's prefix is always inserted/removed at
  // that line's own start, which is at-or-before any position within it, so
  // that line's full delta always applies — this is the same reasoning the
  // old single-line `toggleQuotePrefix` relied on (`pos = caret + delta`),
  // generalized to a block that can contain several lines with different
  // per-line deltas (e.g. a mixed selection where some lines were already
  // quoted and others weren't, in add-mode).
  const shiftFor = (pos: number) => {
    const lineIndex = (value.slice(lineStart, pos).match(/\n/g) ?? []).length;
    let shift = 0;
    for (let i = 0; i <= lineIndex && i < lines.length; i++) {
      shift += newLines[i].length - lines[i].length;
    }
    return shift;
  };

  return { newValue, delta, allQuoted, shiftFor };
}

function renderMessageContent(content: string, members: MemberWithUser[], currentUserId?: string) {
  return tokenizeMentions(content).map((token, i) => {
    if (token.type === 'text') {
      return token.value;
    }
    if (token.type === 'role') {
      return (
        <span key={i} className="mention mention-role">
          @{roleLabel(token.value)}
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

function renderMessageBody(content: string, members: MemberWithUser[], currentUserId?: string) {
  const lines = content.split('\n');
  const groups: { quoted: boolean; lines: string[] }[] = [];

  for (const line of lines) {
    const quoted = line.startsWith(QUOTE_PREFIX);
    const text = quoted ? line.slice(QUOTE_PREFIX.length) : line;
    const last = groups[groups.length - 1];
    if (last && last.quoted === quoted) {
      last.lines.push(text);
    } else {
      groups.push({ quoted, lines: [text] });
    }
  }

  return groups.map((group, i) => {
    const text = group.lines.join('\n');
    const rendered = renderMessageContent(text, members, currentUserId);
    return group.quoted
      ? <span key={i} className="message-quote">{rendered}</span>
      : <span key={i}>{rendered}</span>;
  });
}

function FloatingQuoteButton({ x, y, onConfirm }: { x: number; y: number; onConfirm: () => void }) {
  return (
    <button
      type="button"
      className="floating-quote-btn"
      style={{ left: x, top: y }}
      onMouseDown={(e) => {
        e.preventDefault();
        onConfirm();
      }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>
      <span>Цитата</span>
    </button>
  );
}

export function ChatArea({ channel, user, onMobileBack, onShowMembers }: ChatAreaProps) {
  const { messages, setMessages, addMessage, updateMessage, removeMessage } = useMessageStore();
  const { members } = useServerStore();
  const [input, setInput] = useState('');
  const [caretInQuoteLine, setCaretInQuoteLine] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyMode, setHistoryMode] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Cache for user info (id → username)
  const [userCache, setUserCache] = useState<Map<string, string>>(new Map());

  const currentUserRole = members.find((m) => m.user_id === user?.id)?.role;

  const composeMention = useMentionAutocomplete({
    value: input,
    setValue: setInput,
    inputRef,
    members,
    currentUserRole,
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
      const userIds = new Set<string>();
      for (const msg of messages) {
        if (msg.user_id !== user?.id && !userCache.has(msg.user_id)) {
          userIds.add(msg.user_id);
        }
      }
      for (const uid of userIds) {
        try {
          const fetchedUser = await apiService.getUserById(uid) as User;
          setUserCache((prev) => {
            const next = new Map(prev);
            next.set(fetchedUser.id, fetchedUser.username);
            return next;
          });
        } catch {
          setUserCache((prev) => {
            const next = new Map(prev);
            next.set(uid, uid.slice(0, 8));
            return next;
          });
        }
      }
    };
    if (messages.length > 0) {
      fetchUsernames();
    }
  }, [messages, user, userCache]);

  // Play sound for incoming messages (from other users)
  useEffect(() => {
    const handleMessage = async (payload: unknown) => {
      const msg = payload as Record<string, unknown>;
      if (user && msg.user_id !== user.id) {
        audioService.playMessage();
        // Cache username if not already cached
        if (msg.user_id && !userCache.has(msg.user_id as string)) {
          try {
            const fetchedUser = await apiService.getUserById(msg.user_id as string) as User;
            setUserCache((prev) => {
              const next = new Map(prev);
              next.set(fetchedUser.id, fetchedUser.username);
              return next;
            });
          } catch {
            setUserCache((prev) => {
              const next = new Map(prev);
              next.set(msg.user_id as string, 'Unknown');
              return next;
            });
          }
        }
      }
    };
    const unsub = wsService.on('chat_message', handleMessage);
    return unsub;
  }, [user, userCache]);

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
      console.error('Failed to jump to message:', err);
      setSendError(err instanceof Error ? err.message : 'Не удалось перейти к сообщению');
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
      console.error('Failed to load latest messages:', err);
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
      console.error('Failed to send message:', err);
      setSendError(err instanceof Error ? err.message : 'Failed to send message');
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

  const toggleQuotePrefixRange = (start: number, end: number) => {
    const el = inputRef.current;
    const { newValue, allQuoted, shiftFor } = toggleQuoteLinesInRange(input, start, end);
    const newStart = start + shiftFor(start);
    const newEnd = end + shiftFor(end);
    setInput(newValue);
    setCaretInQuoteLine(!allQuoted);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(newStart, newEnd);
    });
  };

  const toggleQuotePrefix = () => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? input.length;
    toggleQuotePrefixRange(start, end);
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
    currentUserRole,
  });

  useEffect(() => {
    const el = editInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [editValue, editingId]);

  const toggleEditQuotePrefixRange = (start: number, end: number) => {
    const el = editInputRef.current;
    const { newValue, shiftFor } = toggleQuoteLinesInRange(editValue, start, end);
    const newStart = start + shiftFor(start);
    const newEnd = end + shiftFor(end);
    setEditValue(newValue);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(newStart, newEnd);
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
    setEditingId(msg.id);
    setEditValue(msg.content);
    editMention.reset();
  };

  const cancelEdit = () => {
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
      console.error('Failed to update message:', err);
      setSendError(err instanceof Error ? err.message : 'Failed to update message');
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
    if (!window.confirm('Удалить сообщение?')) return;
    try {
      await apiService.deleteMessage(channel.id, messageId);
      removeMessage(messageId);
    } catch (err) {
      console.error('Failed to delete message:', err);
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!channel) {
    return (
      <main className="chat-area">
        <div className="chat-header chat-header--empty">
          {onMobileBack && (
            <button className="mobile-back-btn" onClick={onMobileBack} aria-label="Back">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          )}
        </div>
        <div className="chat-empty">
          <h2>Welcome to Vy Cord!</h2>
          <p>Select a channel to start chatting</p>
        </div>
      </main>
    );
  }

  return (
    <main className="chat-area">
      <div className="chat-header">
        {onMobileBack && (
          <button className="mobile-back-btn" onClick={onMobileBack} aria-label="Back">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        )}
        <span className="channel-hash">#</span>
        <h3>{channel.name}</h3>
        <button
          type="button"
          className={`chat-search-btn${searchOpen ? ' active' : ''}`}
          onClick={() => setSearchOpen((open) => !open)}
          aria-label="Поиск сообщений"
          title="Поиск (Ctrl+Shift+F)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>
        {onShowMembers && (
          <button className="mobile-members-btn" onClick={onShowMembers} aria-label="Members">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </button>
        )}
      </div>

      <div className="chat-messages" ref={chatMessagesRef}>
        {messages.length === 0 ? (
          <div className="welcome-message">
            <h1>Welcome to #{channel.name}!</h1>
            <p>This is the start of the #{channel.name} channel.</p>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => {
              const prevMsg = messages[idx - 1];
              const isFromMe = msg.user_id === user?.id;
              const isCompact =
                prevMsg &&
                prevMsg.user_id === msg.user_id &&
                new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime() < 420000;

              // Get username: from cache or current user
              const displayName = isFromMe
                ? user!.username
                : (userCache.get(msg.user_id) || msg.user_id.slice(0, 8));

              const isEdited = msg.updated_at !== msg.created_at;
              const isEditing = editingId === msg.id;

              return (
                <div
                  key={msg.id}
                  data-message-id={msg.id}
                  className={`message ${isCompact ? 'compact' : ''} ${isFromMe ? 'self' : 'other'}${highlightedId === msg.id ? ' jump-highlight' : ''}`}
                >
                  {!isCompact && !isFromMe && (
                    <div className="message-avatar">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="message-content">
                    {!isCompact && !isFromMe && (
                      <div className="message-header">
                        <span className="message-author">{displayName}</span>
                        <span className="message-timestamp">
                          {formatTime(msg.created_at)}
                          {isEdited && ' (изменено)'}
                        </span>
                      </div>
                    )}
                    {!isCompact && isFromMe && (
                      <div className="message-header self">
                        <span className="message-timestamp">
                          {formatTime(msg.created_at)}
                          {isEdited && ' (изменено)'}
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
                      </div>
                    ) : (
                      <p className="message-text">{renderMessageBody(msg.content, members, user?.id)}</p>
                    )}
                  </div>
                  {!isCompact && isFromMe && (
                    <div className="message-avatar self">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  {isFromMe && !isEditing && (
                    <div className="message-actions">
                      <button
                        type="button"
                        className="message-action-btn"
                        aria-label="Edit"
                        onClick={() => startEdit(msg)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                      </button>
                      <button
                        type="button"
                        className="message-action-btn message-action-btn--danger"
                        aria-label="Delete"
                        onClick={() => handleDelete(msg.id)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </div>
                  )}
                </div>
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
            className={`quote-toggle-btn${caretInQuoteLine ? ' active' : ''}`}
            aria-pressed={caretInQuoteLine}
            onClick={toggleQuotePrefix}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>
            <span>Цитата</span>
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleComposeChange}
            onKeyDown={handleComposeKeyDown}
            onSelect={() => updateQuoteButtonActive()}
            onClick={() => updateQuoteButtonActive()}
            onKeyUp={() => updateQuoteButtonActive()}
            placeholder={`Message #${channel.name}`}
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
          <span>К последним сообщениям</span>
        </button>
      )}
    </main>
  );
}
