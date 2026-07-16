import { useState, useEffect, useMemo, useRef, type FormEvent, type KeyboardEvent, type ChangeEvent } from 'react';
import { useMessageStore } from '@/stores/messageStore';
import type { Message } from '@/types';
import { apiService } from '@/services/api';
import { wsService } from '@/services/websocket';
import { audioService } from '@/services/audio';
import { useServerStore } from '@/stores/serverStore';
import { tokenizeMentions, roleLabel } from '@/utils/mentions';
import type { Channel, User, MemberWithUser, Role } from '@/types';
import './ChatArea.css';

interface ChatAreaProps {
  channel: Channel | null;
  user: User | null;
  onMobileBack?: () => void;
  onShowMembers?: () => void;
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

export function ChatArea({ channel, user, onMobileBack, onShowMembers }: ChatAreaProps) {
  const { messages, addMessage, updateMessage, removeMessage } = useMessageStore();
  const { members } = useServerStore();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cache for user info (id → username)
  const [userCache, setUserCache] = useState<Map<string, string>>(new Map());

  type MentionEntry =
    | { kind: 'user'; id: string; label: string }
    | { kind: 'role'; role: Role; label: string }
    | { kind: 'everyone'; label: string };

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  const currentUserRole = members.find((m) => m.user_id === user?.id)?.role;

  const mentionEntries: MentionEntry[] = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const entries: MentionEntry[] = [];

    for (const m of members) {
      if (m.username.toLowerCase().includes(q)) {
        entries.push({ kind: 'user', id: m.user_id, label: m.username });
      }
    }

    const roleEntries: Array<{ role: Role; label: string }> = [
      { role: 'owner', label: roleLabel('owner') },
      { role: 'admin', label: roleLabel('admin') },
      { role: 'member', label: roleLabel('member') },
    ];
    for (const r of roleEntries) {
      if (r.label.toLowerCase().includes(q) || r.role.includes(q)) {
        entries.push({ kind: 'role', role: r.role, label: r.label });
      }
    }

    if ((currentUserRole === 'owner' || currentUserRole === 'admin') && 'everyone'.includes(q)) {
      entries.push({ kind: 'everyone', label: 'everyone' });
    }

    return entries;
  }, [mentionQuery, members, currentUserRole]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
    setMentionQuery(null);
    setMentionIndex(0);
  }, [channel?.id]);

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!channel || !input.trim() || !user) return;

    try {
      const msg = await apiService.createMessage(channel.id, input.trim()) as Message;
      addMessage(msg);
      setInput('');
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInput(value);

    const caret = e.target.selectionStart ?? value.length;
    const upToCaret = value.slice(0, caret);
    const atIndex = upToCaret.lastIndexOf('@');
    if (atIndex === -1 || /\s/.test(upToCaret.slice(atIndex + 1))) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(upToCaret.slice(atIndex + 1));
    setMentionIndex(0);
  };

  const selectMentionEntry = (entry: MentionEntry) => {
    const caret = inputRef.current?.selectionStart ?? input.length;
    const upToCaret = input.slice(0, caret);
    const atIndex = upToCaret.lastIndexOf('@');
    if (atIndex === -1) return;

    const token =
      entry.kind === 'user' ? `<@${entry.id}>` :
      entry.kind === 'role' ? `<@&${entry.role}>` :
      '@everyone';

    const before = input.slice(0, atIndex);
    const after = input.slice(caret);
    setInput(`${before}${token} ${after}`);
    setMentionQuery(null);

    requestAnimationFrame(() => {
      const pos = before.length + token.length + 1;
      inputRef.current?.setSelectionRange(pos, pos);
      inputRef.current?.focus();
    });
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (mentionQuery === null || mentionEntries.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMentionIndex((i) => (i + 1) % mentionEntries.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMentionIndex((i) => (i - 1 + mentionEntries.length) % mentionEntries.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectMentionEntry(mentionEntries[mentionIndex]);
    } else if (e.key === 'Escape') {
      setMentionQuery(null);
    }
  };

  const mentionEntryKey = (entry: MentionEntry) =>
    entry.kind === 'user' ? entry.id : entry.kind === 'role' ? entry.role : 'everyone';

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const startEdit = (msg: Message) => {
    setEditingId(msg.id);
    setEditValue(msg.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
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
    }
  };

  const handleEditKeyDown = (e: KeyboardEvent<HTMLInputElement>, messageId: string) => {
    if (e.key === 'Enter') {
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
        {onShowMembers && (
          <button className="mobile-members-btn" onClick={onShowMembers} aria-label="Members">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </button>
        )}
      </div>

      <div className="chat-messages">
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
                  className={`message ${isCompact ? 'compact' : ''} ${isFromMe ? 'self' : 'other'}`}
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
                      <input
                        className="message-edit-input"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => handleEditKeyDown(e, msg.id)}
                        onBlur={cancelEdit}
                        maxLength={2000}
                        autoFocus
                      />
                    ) : (
                      <p className="message-text">{renderMessageContent(msg.content, members, user?.id)}</p>
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

      <form className="chat-input" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          placeholder={`Message #${channel.name}`}
          maxLength={2000}
        />
        {mentionQuery !== null && mentionEntries.length > 0 && (
          <ul className="mention-dropdown">
            {mentionEntries.map((entry, i) => (
              <li
                key={mentionEntryKey(entry)}
                className={i === mentionIndex ? 'active' : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectMentionEntry(entry);
                }}
              >
                @{entry.label}
              </li>
            ))}
          </ul>
        )}

      </form>
    </main>
  );
}
