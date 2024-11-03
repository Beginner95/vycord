import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { apiService } from '@/services/api';
import { wsService } from '@/services/websocket';
import { callService } from '@/services/call';
import type { User } from '@/types';
import './UserList.css';

export function UserList() {
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
