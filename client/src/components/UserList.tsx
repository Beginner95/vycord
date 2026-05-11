import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { apiService } from '@/services/api';
import { wsService } from '@/services/websocket';
import { callService } from '@/services/call';
import type { User } from '@/types';
import './UserList.css';

interface UserListProps {
  onMobileBack?: () => void;
}

export function UserList({ onMobileBack }: UserListProps) {
  const { user: currentUser } = useAuthStore();
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);

  useEffect(() => {
    loadOnlineUsers();

    // Listen for WebSocket updates
    wsService.on('online_users', (payload) => {
      const data = payload as { user_ids: string[] };
      if (data.user_ids) {
        loadOnlineUsers();
      }
    });

    wsService.on('user_joined', () => {
      loadOnlineUsers();
    });

    wsService.on('user_left', () => {
      loadOnlineUsers();
    });
  }, []);

  const loadOnlineUsers = async () => {
    try {
      const users = await apiService.getOnlineUsers() as User[];
      setOnlineUsers(users);
    } catch (err) {
      console.error('Failed to load online users:', err);
    }
  };

  const handleCallUser = async (userId: string) => {
    await callService.startCall(userId);
  };

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
        Online — {onlineUsers.length}
      </div>

      {onlineUsers.map((u) => (
        <div key={u.id} className="user-item">
          <div className="user-avatar list online">
            {u.username.charAt(0).toUpperCase()}
          </div>
          <span className="username">{u.username}</span>
          {currentUser && u.id !== currentUser.id && (
            <button
              className="call-user-btn"
              onClick={() => handleCallUser(u.id)}
              title={`Call ${u.username}`}
            >
              📞
            </button>
          )}
        </div>
      ))}
    </aside>
  );
}
