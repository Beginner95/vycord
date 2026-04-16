import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useMessageStore } from '@/stores/messageStore';
import type { Message } from '@/types';
import { apiService } from '@/services/api';
import { wsService } from '@/services/websocket';
import { audioService } from '@/services/audio';
import type { Channel, User } from '@/types';
import './ChatArea.css';

interface ChatAreaProps {
  channel: Channel | null;
  user: User | null;
}

export function ChatArea({ channel, user }: ChatAreaProps) {
  const { messages, addMessage } = useMessageStore();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cache for user info (id → username)
  const [userCache, setUserCache] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
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

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!channel) {
    return (
      <main className="chat-area">
        <div className="chat-empty">
          <h2>Welcome to My Discrod!</h2>
          <p>Select a channel to start chatting</p>
        </div>
      </main>
    );
  }

  return (
    <main className="chat-area">
      <div className="chat-header">
        <span className="channel-hash">#</span>
        <h3>{channel.name}</h3>
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
                        </span>
                      </div>
                    )}
                    {!isCompact && isFromMe && (
                      <div className="message-header self">
                        <span className="message-timestamp">
                          {formatTime(msg.created_at)}
                        </span>
                        <span className="message-author">{displayName}</span>
                      </div>
                    )}
                    <p className="message-text">{msg.content}</p>
                  </div>
                  {!isCompact && isFromMe && (
                    <div className="message-avatar self">
                      {displayName.charAt(0).toUpperCase()}
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
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Message #${channel.name}`}
          maxLength={2000}
        />
      </form>
    </main>
  );
}
