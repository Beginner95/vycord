# Server Member List (Online/Offline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the right-hand `UserList` panel's global "all online users in the system" view with a view of the *current server's* members, split into "Online" and "Offline" groups.

**Architecture:** Client-only change. `UserList.tsx` currently fetches and displays every online user in the whole system via `apiService.getOnlineUsers()`, with no relation to which server is open. It will instead read the current server's roster from `useServerStore().members` (already fetched elsewhere in the app on every server switch) and cross-reference it against a `Set<string>` of globally-online user IDs (still sourced from `apiService.getOnlineUsers()` + the same WebSocket events as today, just reduced to IDs instead of full `User` objects). No backend/API changes.

**Tech Stack:** React + TypeScript (client), Zustand stores (`useServerStore`, `useAuthStore`), existing `wsService`/`apiService`/`callService` singletons.

## Global Constraints

- No backend changes — do not touch anything under `server/`.
- Do not change `AppPage.tsx` or `ChannelSidebar.tsx` — both already provide/consume `useServerStore().members` correctly for their own purposes and must keep working unmodified.
- Use only existing CSS custom properties already defined in `client/src/index.css` (e.g. `--text-muted`, `--bg-primary`, `--radius-full`) — do not introduce new variables or hardcoded colors.
- No new npm dependencies.
- UI copy stays in English, matching the existing "Online — N" label and other sidebar labels ("Text Channels", "Voice Channels") already in the app — do not localize to Russian.
- No new backend/WS events — real-time updates to server *membership* (someone joining/leaving the server while the panel is open) are explicitly out of scope per the spec; only online/offline status must be live.
- Project has no client-side unit test framework (no vitest, no `*.test.ts` files) — verification is TypeScript compilation + manual browser testing, not automated tests.

---

## File Structure

- Modify: `client/src/components/UserList.tsx` — swap data source from "all online users" to "current server's members, split by online status"; sort each group alphabetically; gate the call button on online status.
- Modify: `client/src/components/UserList.css` — add `.offline` avatar/status-dot and dimming styles.

No other files change.

---

### Task 1: Rewrite UserList to show current server's members split into Online/Offline

**Files:**
- Modify: `client/src/components/UserList.tsx` (full rewrite of the component body)
- Modify: `client/src/components/UserList.css:47-58` (insert new offline styles after the existing `.user-avatar.list.online::after` block)

**Interfaces:**
- Consumes: `useServerStore()` → `members: MemberWithUser[]` (`client/src/stores/serverStore.ts`, fields: `user_id`, `username`, `avatar_url?`, `role`, `joined_at`); `apiService.getOnlineUsers()` (`client/src/services/api.ts:218`, returns `unknown`, cast to `User[]` as the existing code already does); `wsService.on(eventType: string, listener: (payload: unknown) => void): () => void` (`client/src/services/websocket.ts:125`); `callService.startCall(receiverId: string): Promise<string | null>` (`client/src/services/call.ts:38`); `useAuthStore()` → `user: User | null`; `Avatar` component (`client/src/components/Avatar.tsx`) props `{ url?: string; username: string; className: string }`.
- Produces: `UserList` component keeps its existing exported signature `UserList({ onMobileBack }: { onMobileBack?: () => void })` — no prop changes, so `AppPage.tsx:366` (`<UserList onMobileBack={() => setMobilePanel('chat')} />`) needs no edit.

- [ ] **Step 1: Read the current file to confirm it matches what this plan assumes**

Run: `cat client/src/components/UserList.tsx`

Expected output (verify it matches before editing — if it has diverged, stop and re-plan):

```tsx
import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { apiService } from '@/services/api';
import { wsService } from '@/services/websocket';
import { callService } from '@/services/call';
import { Avatar } from '@/components/Avatar';
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

    wsService.on('user_updated', () => {
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
          <Avatar url={u.avatar_url} username={u.username} className="user-avatar list online" />
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
```

- [ ] **Step 2: Replace the file with the new implementation**

Write the full new contents of `client/src/components/UserList.tsx`:

```tsx
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
```

- [ ] **Step 3: Add offline styles to UserList.css**

Read `client/src/components/UserList.css` first to find this exact block (currently at lines 47-58):

```css
.user-avatar.list.online::after {
  content: '';
  position: absolute;
  bottom: -1px;
  right: -1px;
  width: 11px;
  height: 11px;
  border-radius: var(--radius-full);
  background: var(--green-color);
  border: 2.5px solid var(--bg-primary);
  box-shadow: 0 0 0 1px var(--green-color);
}
```

Insert immediately after it:

```css
.user-avatar.list.offline::after {
  content: '';
  position: absolute;
  bottom: -1px;
  right: -1px;
  width: 11px;
  height: 11px;
  border-radius: var(--radius-full);
  background: var(--text-muted);
  border: 2.5px solid var(--bg-primary);
}

.user-item.offline .user-avatar.list,
.user-item.offline .username {
  opacity: 0.5;
}
```

- [ ] **Step 4: Type-check the client**

Run: `cd client && npx tsc --noEmit`

Expected: no errors. If errors mention `MemberWithUser` or `User` mismatches, re-check the field names against `client/src/types/index.ts:62-68` (`MemberWithUser`: `user_id`, `username`, `avatar_url?`, `role`, `joined_at`) and `client/src/types/index.ts:1-9` (`User`: `id`, `username`, ...).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/UserList.tsx client/src/components/UserList.css
git commit -m "feat(members): show current server's members split into online/offline"
```

---

### Task 2: Manual browser verification

**Files:** none (verification only, no code changes — no commit at the end of this task).

**Interfaces:**
- Consumes: the running app (client dev server + API server + Postgres), built by Task 1.
- Produces: confidence the feature works end-to-end and nothing else regressed — this is the task's entire deliverable.

- [ ] **Step 1: Start Postgres**

Run: `make docker-up` (from repo root). Confirm it reports Postgres is up (check with `docker ps` if unsure).

- [ ] **Step 2: Start the API server**

Run in a new terminal, from repo root: `make run`
Expected: log line indicating the HTTP server is listening (e.g. mentions port 8080), no panic/exit.

- [ ] **Step 3: Start the client dev server**

Run in a new terminal: `cd client && npm run dev:vite`
Expected: Vite prints a local URL, `http://localhost:3000/`.

- [ ] **Step 4: Open two browser sessions as two different users in the same server**

Open `http://localhost:3000` in a normal browser window, and again in a private/incognito window (so the two sessions don't share `localStorage` auth tokens). Register or log in as two different existing accounts in **both** windows. In each, join (or already be a member of) the **same** server, and select it.

- [ ] **Step 5: Verify the member list shows both users split by status**

In each window's right-hand panel, confirm:
- Both usernames appear.
- Both usernames are listed under "Online — 2" (or however many members that server has — the online count reflects everyone currently connected), with green status dots.
- Since both browser sessions are actively connected, there should be no one under "Offline" yet unless the server has other members who aren't currently logged in — if it does, confirm those show up dimmed under "Offline — N" with grey dots and no call button.

- [ ] **Step 6: Verify offline transition**

Close one of the two browser windows entirely (not just navigate away — actually close the tab/window so the WebSocket disconnects). In the remaining window, within a few seconds, confirm the closed user's row moves from "Online" to "Offline — N" (dimmed, grey dot, call button gone) without a manual page refresh.

- [ ] **Step 7: Verify the call button still works for online members**

With both windows open and both users online again (reopen the closed window and log back in), hover an online member's row other than yourself in one window and confirm the 📞 button appears and clicking it triggers the existing call flow (a ringing/incoming-call UI appears in the other window). This confirms `callService.startCall` wiring wasn't broken by the rewrite.

- [ ] **Step 8: Verify no regression in ChannelSidebar voice-participant name resolution**

If the server has a voice channel, join it from one browser window, then in the other window expand that voice channel in `ChannelSidebar` and confirm the joined user's real username and avatar show (not a truncated user-id fallback). This exercises `ChannelSidebar`'s existing `members` prop usage, which Task 1 did not touch but which reads from the same `useServerStore().members` — confirms the shared data source wasn't broken.

- [ ] **Step 9: Verify mobile panel toggle still works**

Shrink the browser window (or use devtools responsive mode) below 768px width. Confirm the bottom/header "members" navigation still opens the same panel showing the Online/Offline groups, and the back button returns to chat.

---

## Self-Review Notes

- **Spec coverage:** online/offline split ✓ (Task 1), alphabetical sort within groups ✓ (Task 1, `sortByUsername`), no role badges ✓ (not added), call button only for online ✓ (Task 1 `renderMember`), empty-state = empty groups with no spinner ✓ (no loading state added, `members` defaults to `[]` in the store), no backend changes ✓ (File Structure section touches only two client files), `AppPage.tsx`/`ChannelSidebar.tsx` unmodified ✓ (Global Constraints + confirmed prop signature unchanged), CSS reuses existing variables ✓ (Task 1 Step 3 uses only `--radius-full`, `--text-muted`, `--bg-primary`, already defined in `client/src/index.css`).
- **Placeholder scan:** none — all steps contain literal file contents or literal shell commands.
- **Type consistency:** `MemberWithUser` field names (`user_id`, `username`, `avatar_url`) and `User` field names (`id`, `username`, `avatar_url`) used identically in Task 1 Step 2 match `client/src/types/index.ts`. `UserList` prop signature (`onMobileBack?: () => void`) is unchanged from the original, so no caller elsewhere needs updating.
