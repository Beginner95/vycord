import { useState, useEffect, useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { apiService } from '@/services/api';
import { wsService } from '@/services/websocket';
import { callService } from '@/services/call';
import { Avatar } from '@/components/Avatar';
import type { User, MemberWithUser } from '@/types';
import './UserList.css';

interface UserListProps {
  onMobileBack?: () => void;
}

function sortByUsername(members: MemberWithUser[]): MemberWithUser[] {
  return [...members].sort((a, b) =>
    a.username.localeCompare(b.username, undefined, { sensitivity: 'base' })
  );
}

export function UserList({ onMobileBack }: UserListProps) {
  const { user: currentUser } = useAuthStore();
  const { members } = useServerStore();
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadOnlineIds();

    // Any of these events means the set of globally-online users may have
    // changed, so re-fetch. (user_updated fires on avatar changes too, but
    // re-fetching on it is harmless — same trigger set the old code used.)
    const unsubscribers = [
      wsService.on('online_users', () => loadOnlineIds()),
      wsService.on('user_joined', () => loadOnlineIds()),
      wsService.on('user_left', () => loadOnlineIds()),
      wsService.on('user_updated', () => loadOnlineIds()),
    ];

    return () => unsubscribers.forEach((unsub) => unsub());
  }, []);

  const loadOnlineIds = async () => {
    try {
      const users = await apiService.getOnlineUsers() as User[];
      setOnlineIds(new Set(users.map((u) => u.id)));
    } catch (err) {
      console.error('Failed to load online users:', err);
    }
  };

  const handleCallUser = async (userId: string) => {
    await callService.startCall(userId);
  };

  const { onlineMembers, offlineMembers } = useMemo(() => {
    const online: MemberWithUser[] = [];
    const offline: MemberWithUser[] = [];
    for (const m of members) {
      (onlineIds.has(m.user_id) ? online : offline).push(m);
    }
    return { onlineMembers: sortByUsername(online), offlineMembers: sortByUsername(offline) };
  }, [members, onlineIds]);

  const renderMember = (m: MemberWithUser, online: boolean) => (
    <div key={m.user_id} className={`user-item${online ? '' : ' offline'}`}>
      <Avatar
        url={m.avatar_url}
        username={m.username}
        className={`user-avatar list ${online ? 'online' : 'offline'}`}
      />
      <span className="username">{m.username}</span>
      {online && currentUser && m.user_id !== currentUser.id && (
        <button
          className="call-user-btn"
          onClick={() => handleCallUser(m.user_id)}
          title={`Call ${m.username}`}
        >
          📞
        </button>
      )}
    </div>
  );

  return (
    <aside className="user-list">
      <div className="user-list-mobile-header">
        {onMobileBack && (
          <button className="mobile-back-btn" onClick={onMobileBack} aria-label="Back">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        )}
        <span>Members</span>
      </div>

      <div className="user-category">
        Online — {onlineMembers.length}
      </div>
      {onlineMembers.map((m) => renderMember(m, true))}

      <div className="user-category">
        Offline — {offlineMembers.length}
      </div>
      {offlineMembers.map((m) => renderMember(m, false))}
    </aside>
  );
}
