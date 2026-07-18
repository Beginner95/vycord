# Mic Status & Speaking Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a mute/unmute badge and a "speaking now" glow on every remote participant's tile, in both group calls (`GroupCallUI.tsx`) and 1-on-1 calls (`CallUI.tsx`), so users can tell at a glance who's muted and who's currently talking.

**Architecture:** Mute state travels as new WS events `mic_muted`/`mic_unmuted`, broadcast globally through the existing hub — mirrors the already-shipped `screen_share_started`/`screen_share_stopped` pattern exactly (transient, no server-side state). Speaking detection stays 100% client-side: the existing `useMicLevel` hook (AudioContext + AnalyserNode, threshold `level > 0.05`) is applied to each remote participant's `MediaStream` instead of only the local one. Both signals render through one shared visual component: a small circular badge (bottom-right corner of the tile) with 3 states — muted (red), speaking (green, pulsing), idle (gray) — replacing the existing local-only `mic-dot`/`.speaking` styling so all tiles (own + remote) share one visual language.

**Tech Stack:** React 18 + TypeScript (client), Go (server), no new dependencies.

## Global Constraints

- No new server-side state — `mic_muted`/`mic_unmuted` are pure broadcasts, matching the untested `screen_share_started/stopped` precedent (spec explicitly decided against adding tests for this handler — see spec's "Тестирование" section).
- No new client test infrastructure — the project has no frontend test framework; verification is `tsc --noEmit` (type safety) + manual browser QA, per spec.
- Reuse `useMicLevel` as-is (no signature changes) — it already accepts `(stream, isMuted)` and zeroes the level when muted.
- Icon reuse: muted badge uses 🔇 (already means "muted" on the call-control button) — never 🚫 (already means "mic unavailable" elsewhere in the same UI).
- Badge sits bottom-right of every tile; `.focus-btn` (grid remote tiles) is top-right — no overlap.

---

## File Structure

- Modify: `server/internal/delivery/http/handler/websocket.go` — two new WS message handlers, two new `switch` cases
- Modify: `client/src/services/call.ts` — one new public getter (`remoteUserIdState`) so `CallUI.tsx` can filter incoming mic events to the current call's peer
- Modify: `client/src/components/CallUI.tsx` + `client/src/components/CallUI.css` — remote + local mic badge for 1-on-1 calls
- Modify: `client/src/components/GroupCallUI.tsx` + `client/src/components/GroupCallUI.css` — `RemoteParticipantTile` subcomponent, mic-state map, WS wiring, local mic badge

No new files — everything extends existing files, consistent with how `screen_share_*` was added.

---

### Task 1: Server — `mic_muted`/`mic_unmuted` WS events

**Files:**
- Modify: `server/internal/delivery/http/handler/websocket.go:182-185` (switch cases), `:575-581` (new handler functions, placed after `handleScreenShareStopped`)

**Interfaces:**
- Produces: WS message types `"mic_muted"` and `"mic_unmuted"`, broadcast to all clients with payload `{"user_id": "<uuid>"}` — consumed by Task 3 and Task 4 on the client.

- [ ] **Step 1: Add the two switch cases**

In `handleMessage`, insert immediately after the existing `screen_share_stopped` case (currently `websocket.go:184-185`) and before `voice_joined`:

```go
	case "screen_share_started":
		h.handleScreenShareStarted(client)
	case "screen_share_stopped":
		h.handleScreenShareStopped(client)
	case "mic_muted":
		h.handleMicMuted(client)
	case "mic_unmuted":
		h.handleMicUnmuted(client)
	case "voice_joined":
		h.handleVoiceJoined(client, msg)
```

- [ ] **Step 2: Add the two handler functions**

Insert immediately after `handleScreenShareStopped` (currently ends at `websocket.go:581`), before `handlePing`:

```go
func (h *WebSocketHandler) handleMicMuted(client *ws.Client) {
	h.log.Info("mic muted", "user_id", client.UserID)
	h.hub.BroadcastMessage(&ws.Message{
		Type:    "mic_muted",
		Payload: mustMarshal(map[string]interface{}{"user_id": client.UserID.String()}),
	})
}

func (h *WebSocketHandler) handleMicUnmuted(client *ws.Client) {
	h.log.Info("mic unmuted", "user_id", client.UserID)
	h.hub.BroadcastMessage(&ws.Message{
		Type:    "mic_unmuted",
		Payload: mustMarshal(map[string]interface{}{"user_id": client.UserID.String()}),
	})
}
```

- [ ] **Step 3: Verify it builds and existing tests still pass**

Run: `cd server && go build ./... && go vet ./... && go test ./...`
Expected: all commands exit 0; no new test is added here, matching the untested `screen_share_started/stopped` precedent this mirrors.

- [ ] **Step 4: Commit**

```bash
git add server/internal/delivery/http/handler/websocket.go
git commit -m "feat(ws): add mic_muted/mic_unmuted broadcast events"
```

---

### Task 2: Client — expose the current call's peer user ID from `call.ts`

**Files:**
- Modify: `client/src/services/call.ts:314-324` (getters block, right after `isMicrophoneAvailable`)

**Interfaces:**
- Consumes: existing private field `this.remoteUserId: string | null` (already set/cleared throughout the file — no logic changes).
- Produces: `callService.remoteUserIdState: string | null` — consumed by Task 3 to filter incoming `mic_muted`/`mic_unmuted` events to the actual call peer (a 1-on-1 call only has one remote party).

- [ ] **Step 1: Add the getter**

In `call.ts`, right after the existing `isMicrophoneAvailable` getter (`call.ts:322-324`):

```ts
  get isMicrophoneAvailable(): boolean {
    return this._microphoneAvailable;
  }

  get remoteUserIdState(): string | null {
    return this.remoteUserId;
  }
```

- [ ] **Step 2: Verify types**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/services/call.ts
git commit -m "feat(call): expose remoteUserIdState getter"
```

---

### Task 3: Client — mic badge + speaking indicator in `CallUI.tsx` (1-on-1 calls)

**Files:**
- Modify: `client/src/components/CallUI.css:215-235` (replace `.mic-dot`/`@keyframes mic-blink` with `.mic-badge` + modifiers; add `.remote-video.speaking`)
- Modify: `client/src/components/CallUI.tsx` (imports, state, WS listeners, send points, render)

**Interfaces:**
- Consumes: `wsService.on('mic_muted' | 'mic_unmuted', (payload: unknown) => void): () => void` and `wsService.send(type: string, payload: unknown): void` (existing, `websocket.ts:125,137`); `callService.remoteUserIdState` (Task 2); WS events from Task 1.
- Produces: nothing consumed by later tasks — `GroupCallUI.tsx` (Task 4) duplicates this pattern independently since the two components don't share call state.

- [ ] **Step 1: Replace `.mic-dot` with `.mic-badge` in `CallUI.css`**

Replace (currently `CallUI.css:221-235`):

```css
.mic-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22c55e;
  margin-right: 5px;
  vertical-align: middle;
  animation: mic-blink 0.6s ease-in-out infinite alternate;
}

@keyframes mic-blink {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0.5; transform: scale(0.75); }
}
```

with:

```css
.mic-badge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  z-index: 2;
}

.mic-badge--idle {
  background: rgba(15, 17, 23, 0.65);
  color: rgba(255, 255, 255, 0.6);
}

.mic-badge--muted {
  background: rgba(239, 68, 68, 0.92);
  color: white;
}

.mic-badge--speaking {
  background: rgba(34, 197, 94, 0.92);
  color: white;
  animation: mic-badge-pulse 1s ease-in-out infinite;
}

@keyframes mic-badge-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}
```

Also add, right after the existing `.local-video.speaking` rule (`CallUI.css:215-219`):

```css
.remote-video.speaking {
  box-shadow: inset 0 0 0 4px rgba(34, 197, 94, 0.5);
  transition: box-shadow 0.1s ease;
}
```

- [ ] **Step 2: Import `wsService` in `CallUI.tsx`**

`CallUI.tsx:1-5` currently:

```ts
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { callService } from '@/services/call';
import { audioService } from '@/services/audio';
import './CallUI.css';
```

Change to:

```ts
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { callService } from '@/services/call';
import { audioService } from '@/services/audio';
import { wsService } from '@/services/websocket';
import './CallUI.css';
```

- [ ] **Step 3: Add `remoteMicMuted` state and the remote-stream VAD hook**

`CallUI.tsx:49-55` currently:

```ts
  const [isMuted, setIsMuted] = useState(false);
  const [isMicAvailable, setIsMicAvailable] = useState(true);
  const [isVideoOff, setIsVideoOff] = useState(true);
  const micLevel = useMicLevel(
    activeCall ? callService.localStreamState : null,
    isMuted,
  );
```

Change to:

```ts
  const [isMuted, setIsMuted] = useState(false);
  const [isMicAvailable, setIsMicAvailable] = useState(true);
  const [isVideoOff, setIsVideoOff] = useState(true);
  const [remoteMicMuted, setRemoteMicMuted] = useState(false);
  const micLevel = useMicLevel(
    activeCall ? callService.localStreamState : null,
    isMuted,
  );
  const remoteMicLevel = useMicLevel(
    activeCall ? remoteStream : null,
    remoteMicMuted,
  );
```

- [ ] **Step 4: Send own mic state when the call becomes active, on both call-start paths**

`CallUI.tsx:91-100` (`handleCallStarted` — the caller's side, once the callee accepts) currently:

```ts
    const handleCallStarted = (e: CustomEvent) => {
      audioService.stopRingtone();
      audioService.playCallAccepted();
      setActiveCall(e.detail);
      setIncomingCall(null);
      const micAvailable = callService.isMicrophoneAvailable;
      setIsMicAvailable(micAvailable);
      if (!micAvailable) setIsMuted(true);
    };
```

Change to:

```ts
    const handleCallStarted = (e: CustomEvent) => {
      audioService.stopRingtone();
      audioService.playCallAccepted();
      setActiveCall(e.detail);
      setIncomingCall(null);
      const micAvailable = callService.isMicrophoneAvailable;
      setIsMicAvailable(micAvailable);
      if (!micAvailable) setIsMuted(true);
      wsService.send(micAvailable ? 'mic_unmuted' : 'mic_muted', {});
    };
```

`CallUI.tsx:116-125` (`handleAcceptCall` — the callee's side) currently:

```ts
  const handleAcceptCall = useCallback(async () => {
    await callService.acceptCall();
    const micAvailable = callService.isMicrophoneAvailable;
    setIsMicAvailable(micAvailable);
    if (!micAvailable) setIsMuted(true);
    if (incomingCall) {
      setActiveCall({ call_id: incomingCall.call_id });
    }
    setIncomingCall(null);
  }, [incomingCall]);
```

Change to:

```ts
  const handleAcceptCall = useCallback(async () => {
    await callService.acceptCall();
    const micAvailable = callService.isMicrophoneAvailable;
    setIsMicAvailable(micAvailable);
    if (!micAvailable) setIsMuted(true);
    wsService.send(micAvailable ? 'mic_unmuted' : 'mic_muted', {});
    if (incomingCall) {
      setActiveCall({ call_id: incomingCall.call_id });
    }
    setIncomingCall(null);
  }, [incomingCall]);
```

- [ ] **Step 5: Send updated state on toggle, and reset `remoteMicMuted` on call end**

`CallUI.tsx:137-140` currently:

```ts
  const handleToggleMute = () => {
    const muted = callService.toggleMuteAudio();
    setIsMuted(muted);
  };
```

Change to:

```ts
  const handleToggleMute = () => {
    const muted = callService.toggleMuteAudio();
    setIsMuted(muted);
    wsService.send(muted ? 'mic_muted' : 'mic_unmuted', {});
  };
```

`CallUI.tsx:68-77` (`onCallEnded` callback inside `callService.init`) currently:

```ts
      onCallEnded: () => {
        audioService.stopRingtone();
        audioService.playCallEnded();
        setActiveCall(null);
        setIncomingCall(null);
        setRemoteStream(null);
        setIsMuted(false);
        setIsMicAvailable(true);
        setIsVideoOff(false);
      },
```

Change to:

```ts
      onCallEnded: () => {
        audioService.stopRingtone();
        audioService.playCallEnded();
        setActiveCall(null);
        setIncomingCall(null);
        setRemoteStream(null);
        setIsMuted(false);
        setIsMicAvailable(true);
        setIsVideoOff(false);
        setRemoteMicMuted(false);
      },
```

- [ ] **Step 6: Listen for the peer's mic events while the call is active**

Add a new `useEffect`, right after the existing "Attach remote stream after video element is mounted" effect (`CallUI.tsx:154-158`):

```ts
  // Listen for the remote peer's mic mute state via the main WS
  useEffect(() => {
    if (!activeCall) return;

    const unsubMuted = wsService.on('mic_muted', (payload) => {
      const p = payload as { user_id: string };
      if (p.user_id !== callService.remoteUserIdState) return;
      setRemoteMicMuted(true);
    });
    const unsubUnmuted = wsService.on('mic_unmuted', (payload) => {
      const p = payload as { user_id: string };
      if (p.user_id !== callService.remoteUserIdState) return;
      setRemoteMicMuted(false);
    });

    return () => { unsubMuted(); unsubUnmuted(); };
  }, [activeCall]);
```

- [ ] **Step 7: Render the badges**

`CallUI.tsx:189-213` currently:

```tsx
          <div className="call-videos">
            <div className="remote-video">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
              />
              <div className="call-timer">
                <CallTimer />
              </div>
            </div>
            <div className={`local-video ${micLevel > 0.05 ? 'speaking' : ''}`}>
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
              />
              {user && (
                <div className="local-video-label">
                  {!isMuted && micLevel > 0.05 && <span className="mic-dot" />}
                  {user.username} (You)
                </div>
              )}
            </div>
          </div>
```

Change to:

```tsx
          <div className="call-videos">
            <div className={`remote-video ${remoteMicLevel > 0.05 ? 'speaking' : ''}`}>
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
              />
              <div className="call-timer">
                <CallTimer />
              </div>
              {remoteStream && (
                <div className={`mic-badge ${remoteMicMuted ? 'mic-badge--muted' : remoteMicLevel > 0.05 ? 'mic-badge--speaking' : 'mic-badge--idle'}`}>
                  {remoteMicMuted ? '🔇' : '🎤'}
                </div>
              )}
            </div>
            <div className={`local-video ${micLevel > 0.05 ? 'speaking' : ''}`}>
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
              />
              <div className={`mic-badge ${isMuted ? 'mic-badge--muted' : micLevel > 0.05 ? 'mic-badge--speaking' : 'mic-badge--idle'}`}>
                {isMuted ? '🔇' : '🎤'}
              </div>
              {user && (
                <div className="local-video-label">
                  {user.username} (You)
                </div>
              )}
            </div>
          </div>
```

- [ ] **Step 8: Verify types**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 9: Manual smoke check**

Run: `npm run dev:vite` (from `client/`), open the app in two browser profiles/windows, log in as two different users, start a 1-on-1 call.
Expected: toggling mute on either side flips the other side's badge to 🔇 (red) within roughly one WS round-trip; talking flips the badge to a pulsing green circle and puts a green inset glow around the remote video; muted never shows the green pulse even if you speak.

- [ ] **Step 10: Commit**

```bash
git add client/src/components/CallUI.tsx client/src/components/CallUI.css
git commit -m "feat(call): show remote mic mute status and speaking indicator"
```

---

### Task 4: Client — `RemoteParticipantTile` + mic state wiring in `GroupCallUI.tsx`

**Files:**
- Modify: `client/src/components/GroupCallUI.css:275-289` (replace `.mic-dot`/`@keyframes mic-blink` with `.mic-badge` + modifiers), `:793-796` area (add `.thumbnail-tile.speaking` + thumbnail-sized badge override)
- Modify: `client/src/components/GroupCallUI.tsx` (new subcomponent, state, WS wiring, send points, render)

**Interfaces:**
- Consumes: WS events from Task 1; existing `RemoteParticipant { userId: string; stream: MediaStream | null }` (`GroupCallUI.tsx:48-51`); existing `useMicLevel(stream, isMuted): number` hook (`GroupCallUI.tsx:13-46`, unchanged); existing `participantsRef` pattern (`GroupCallUI.tsx:206-211`).
- Produces: `RemoteParticipantTile` component (local to this file, not exported) — no other file needs it.

- [ ] **Step 1: Replace `.mic-dot` with `.mic-badge` in `GroupCallUI.css`**

Replace (currently `GroupCallUI.css:275-289`):

```css
.mic-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22c55e;
  margin-right: 5px;
  vertical-align: middle;
  animation: mic-blink 0.6s ease-in-out infinite alternate;
}

@keyframes mic-blink {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0.5; transform: scale(0.75); }
}
```

with:

```css
.mic-badge {
  position: absolute;
  bottom: 10px;
  right: 10px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  z-index: 2;
}

.mic-badge--idle {
  background: rgba(15, 17, 23, 0.65);
  color: rgba(255, 255, 255, 0.6);
}

.mic-badge--muted {
  background: rgba(239, 68, 68, 0.92);
  color: white;
}

.mic-badge--speaking {
  background: rgba(34, 197, 94, 0.92);
  color: white;
  animation: mic-badge-pulse 1s ease-in-out infinite;
}

@keyframes mic-badge-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}
```

- [ ] **Step 2: Add thumbnail-sized badge + speaking border**

Right after the existing `.thumbnail-tile--focused` rule (currently `GroupCallUI.css:793-796`):

```css
.thumbnail-tile--focused {
  border-color: var(--brand-500, #6366f1);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.4);
}

.thumbnail-tile.speaking {
  border-color: rgba(34, 197, 94, 0.85);
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.45);
}

.thumbnail-tile .mic-badge {
  width: 16px;
  height: 16px;
  font-size: 8px;
  bottom: 4px;
  right: 4px;
}
```

- [ ] **Step 3: Add the `RemoteParticipantTile` subcomponent**

Hooks can't be called inside `.map()`, so speaking detection for each remote participant needs its own component instance. Insert right after `ScreenQualityPicker` (currently ends at `GroupCallUI.tsx:175`) and before `export function GroupCallUI() {` (`GroupCallUI.tsx:177`):

```tsx
// ─── Remote Participant Tile ─────────────────────────────────────────────────
// Wraps useMicLevel per participant — hooks can't run inside .map(), so each
// remote tile (grid or thumbnail) needs its own component instance.

interface RemoteParticipantTileProps {
  participant: RemoteParticipant;
  displayName: string;
  muted: boolean;
  isSharing: boolean;
  layout: 'grid' | 'thumbnail';
  isFocused?: boolean;
  onFocus: () => void;
  videoRefSetter: (el: HTMLVideoElement | null) => void;
}

function RemoteParticipantTile({
  participant,
  displayName,
  muted,
  isSharing,
  layout,
  isFocused,
  onFocus,
  videoRefSetter,
}: RemoteParticipantTileProps) {
  const level = useMicLevel(participant.stream, muted);
  const speaking = level > 0.05;
  const micBadgeClass = muted
    ? 'mic-badge--muted'
    : speaking
      ? 'mic-badge--speaking'
      : 'mic-badge--idle';

  if (layout === 'thumbnail') {
    return (
      <div
        className={`thumbnail-tile ${isFocused ? 'thumbnail-tile--focused' : ''} ${speaking ? 'speaking' : ''}`}
        onClick={onFocus}
        title={displayName}
      >
        <video ref={videoRefSetter} autoPlay playsInline />
        {!participant.stream && <div className="thumbnail-placeholder">📷</div>}
        {isSharing && <div className="thumbnail-badge">🖥</div>}
        <div className={`mic-badge ${micBadgeClass}`}>{muted ? '🔇' : '🎤'}</div>
        <div className="thumbnail-label">{displayName}</div>
      </div>
    );
  }

  return (
    <div className={`video-tile ${!participant.stream ? 'video-off' : ''} ${speaking ? 'speaking' : ''}`}>
      <video ref={videoRefSetter} autoPlay playsInline />
      {!participant.stream && <div className="video-off-placeholder">📷</div>}
      {isSharing && <div className="screen-share-badge">🖥 Sharing</div>}
      <button className="focus-btn" onClick={onFocus} title="Focus on this participant">⛶</button>
      <div className={`mic-badge ${micBadgeClass}`}>{muted ? '🔇' : '🎤'}</div>
      <div className="video-label">{displayName}</div>
    </div>
  );
}
```

- [ ] **Step 4: Add `remoteMicMuted` map + `isMutedRef`**

`GroupCallUI.tsx:206-211` currently:

```ts
  // Stable ref to participants for use in WS event callbacks (avoids stale closure)
  const participantsRef = useRef<RemoteParticipant[]>([]);

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);
```

Change to:

```ts
  // Stable ref to participants for use in WS event callbacks (avoids stale closure)
  const participantsRef = useRef<RemoteParticipant[]>([]);

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  const [remoteMicMuted, setRemoteMicMuted] = useState<Map<string, boolean>>(new Map());

  // Stable ref to isMuted for use in the onPeerJoined WS callback (avoids stale closure)
  const isMutedRef = useRef(isMuted);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);
```

- [ ] **Step 5: Re-send own mic state on `onPeerJoined`, clean up `remoteMicMuted` on peer-left/reconnect/end/error**

`GroupCallUI.tsx:233-284` currently:

```ts
      onPeerJoined: (userId) => {
        setParticipants((prev) => {
          if (prev.find((p) => p.userId === userId)) return prev;
          return [...prev, { userId, stream: null }];
        });
      },
      onPeerLeft: (userId) => {
        setParticipants((prev) => prev.filter((p) => p.userId !== userId));
      },
      onReconnecting: () => {
        setIsReconnecting(true);
        // Participants are re-announced via 'joined'/onPeerJoined after
        // rejoin; clear now so users who left during the outage don't linger.
        setParticipants([]);
        setScreenSharers(new Set());
        setFocusedUserId(null);
      },
      onReconnected: () => {
        setIsReconnecting(false);
      },
      onCallEnded: () => {
        const channelId = groupCallService.currentRoomIdState;
        if (channelId) wsService.send('voice_left', { channel_id: channelId });
        setIsReconnecting(false);
        setIsInGroupCall(false);
        setParticipants([]);
        setIsMuted(false);
        setIsMicAvailable(true);
        setIsVideoOff(false);
        setIsScreenSharing(false);
        setShowSourcePicker(false);
        setScreenSharers(new Set());
        setFocusedUserId(null);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      },
      onError: (msg) => {
        const channelId = groupCallService.currentRoomIdState;
        if (channelId) wsService.send('voice_left', { channel_id: channelId });
        setIsReconnecting(false);
        console.error('[GroupCall] Error:', msg);
        setIsInGroupCall(false);
        setParticipants([]);
        setIsMicAvailable(true);
        setScreenSharers(new Set());
        setFocusedUserId(null);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        groupCallService.leaveGroupCall();
      },
```

Change to (each block gets one addition — `onPeerJoined` re-sends own state, the other four clear `remoteMicMuted`):

```ts
      onPeerJoined: (userId) => {
        setParticipants((prev) => {
          if (prev.find((p) => p.userId === userId)) return prev;
          return [...prev, { userId, stream: null }];
        });
        // Fires both when I discover an already-present peer and when someone
        // joins after me — re-announcing my mic state either way is harmless
        // and closes the window where a newly-joined peer doesn't know it yet.
        wsService.send(isMutedRef.current ? 'mic_muted' : 'mic_unmuted', {});
      },
      onPeerLeft: (userId) => {
        setParticipants((prev) => prev.filter((p) => p.userId !== userId));
        setRemoteMicMuted((prev) => {
          const next = new Map(prev);
          next.delete(userId);
          return next;
        });
      },
      onReconnecting: () => {
        setIsReconnecting(true);
        // Participants are re-announced via 'joined'/onPeerJoined after
        // rejoin; clear now so users who left during the outage don't linger.
        setParticipants([]);
        setScreenSharers(new Set());
        setRemoteMicMuted(new Map());
        setFocusedUserId(null);
      },
      onReconnected: () => {
        setIsReconnecting(false);
      },
      onCallEnded: () => {
        const channelId = groupCallService.currentRoomIdState;
        if (channelId) wsService.send('voice_left', { channel_id: channelId });
        setIsReconnecting(false);
        setIsInGroupCall(false);
        setParticipants([]);
        setIsMuted(false);
        setIsMicAvailable(true);
        setIsVideoOff(false);
        setIsScreenSharing(false);
        setShowSourcePicker(false);
        setScreenSharers(new Set());
        setRemoteMicMuted(new Map());
        setFocusedUserId(null);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      },
      onError: (msg) => {
        const channelId = groupCallService.currentRoomIdState;
        if (channelId) wsService.send('voice_left', { channel_id: channelId });
        setIsReconnecting(false);
        console.error('[GroupCall] Error:', msg);
        setIsInGroupCall(false);
        setParticipants([]);
        setIsMicAvailable(true);
        setScreenSharers(new Set());
        setRemoteMicMuted(new Map());
        setFocusedUserId(null);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        groupCallService.leaveGroupCall();
      },
```

- [ ] **Step 6: Send own mic state right after joining, and on toggle**

`GroupCallUI.tsx:419-428` (end of `handleJoinGroupCall`) currently:

```ts
    const isFirst = await groupCallService.joinGroupCall(roomId, user.id);
    if (!alreadyInThisRoom && groupCallService.currentRoomIdState === roomId) {
      wsService.send('voice_joined', { channel_id: roomId });
    }
    setIsInGroupCall(true);
    const micAvailable = groupCallService.isMicrophoneAvailable;
    setIsMicAvailable(micAvailable);
    if (!micAvailable) setIsMuted(true);
    return isFirst;
  }, [user]);
```

Change to:

```ts
    const isFirst = await groupCallService.joinGroupCall(roomId, user.id);
    if (!alreadyInThisRoom && groupCallService.currentRoomIdState === roomId) {
      wsService.send('voice_joined', { channel_id: roomId });
    }
    setIsInGroupCall(true);
    const micAvailable = groupCallService.isMicrophoneAvailable;
    setIsMicAvailable(micAvailable);
    if (!micAvailable) setIsMuted(true);
    wsService.send(micAvailable ? 'mic_unmuted' : 'mic_muted', {});
    return isFirst;
  }, [user]);
```

`GroupCallUI.tsx:458-461` (`handleToggleMute`) currently:

```ts
  const handleToggleMute = useCallback(() => {
    const muted = groupCallService.toggleMuteAudio();
    setIsMuted(muted);
  }, []);
```

Change to:

```ts
  const handleToggleMute = useCallback(() => {
    const muted = groupCallService.toggleMuteAudio();
    setIsMuted(muted);
    wsService.send(muted ? 'mic_muted' : 'mic_unmuted', {});
  }, []);
```

- [ ] **Step 7: Listen for remote mic events**

`GroupCallUI.tsx:326-356` currently:

```ts
  // Listen for remote screen share events via main WS
  useEffect(() => {
    if (!isInGroupCall) return;

    const unsubStart = wsService.on('screen_share_started', (payload) => {
      const p = payload as { user_id: string };
      if (p.user_id === user?.id) return; // ignore own events
      // Only care about current call participants
      if (!participantsRef.current.some((pt) => pt.userId === p.user_id)) return;
      setScreenSharers((prev) => new Set([...prev, p.user_id]));
    });

    const unsubStop = wsService.on('screen_share_stopped', (payload) => {
      const p = payload as { user_id: string };
      setScreenSharers((prev) => {
        const next = new Set(prev);
        next.delete(p.user_id);
        return next;
      });
      // If this participant was focused, exit focus view and fullscreen
      setFocusedUserId((prev) => {
        if (prev === p.user_id) {
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          return null;
        }
        return prev;
      });
    });

    return () => { unsubStart(); unsubStop(); };
  }, [isInGroupCall, user?.id]);
```

Change to:

```ts
  // Listen for remote screen share events via main WS
  useEffect(() => {
    if (!isInGroupCall) return;

    const unsubStart = wsService.on('screen_share_started', (payload) => {
      const p = payload as { user_id: string };
      if (p.user_id === user?.id) return; // ignore own events
      // Only care about current call participants
      if (!participantsRef.current.some((pt) => pt.userId === p.user_id)) return;
      setScreenSharers((prev) => new Set([...prev, p.user_id]));
    });

    const unsubStop = wsService.on('screen_share_stopped', (payload) => {
      const p = payload as { user_id: string };
      setScreenSharers((prev) => {
        const next = new Set(prev);
        next.delete(p.user_id);
        return next;
      });
      // If this participant was focused, exit focus view and fullscreen
      setFocusedUserId((prev) => {
        if (prev === p.user_id) {
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          return null;
        }
        return prev;
      });
    });

    const unsubMicMuted = wsService.on('mic_muted', (payload) => {
      const p = payload as { user_id: string };
      if (p.user_id === user?.id) return;
      if (!participantsRef.current.some((pt) => pt.userId === p.user_id)) return;
      setRemoteMicMuted((prev) => new Map(prev).set(p.user_id, true));
    });

    const unsubMicUnmuted = wsService.on('mic_unmuted', (payload) => {
      const p = payload as { user_id: string };
      if (p.user_id === user?.id) return;
      if (!participantsRef.current.some((pt) => pt.userId === p.user_id)) return;
      setRemoteMicMuted((prev) => new Map(prev).set(p.user_id, false));
    });

    return () => { unsubStart(); unsubStop(); unsubMicMuted(); unsubMicUnmuted(); };
  }, [isInGroupCall, user?.id]);
```

- [ ] **Step 8: Use `RemoteParticipantTile` in the thumbnail strip**

`GroupCallUI.tsx:697-716` currently:

```tsx
                {/* Remote thumbnails */}
                {participants.map((p) => (
                  <div
                    key={p.userId}
                    className={`thumbnail-tile ${focusedUserId === p.userId ? 'thumbnail-tile--focused' : ''}`}
                    onClick={() => setFocusedUserId(p.userId)}
                    title={userCache.get(p.userId) ?? p.userId.slice(0, 8)}
                  >
                    <video
                      ref={(el) => { if (el) remoteVideoRefs.current.set(p.userId, el); }}
                      autoPlay
                      playsInline
                    />
                    {!p.stream && <div className="thumbnail-placeholder">📷</div>}
                    {screenSharers.has(p.userId) && <div className="thumbnail-badge">🖥</div>}
                    <div className="thumbnail-label">
                      {userCache.get(p.userId) ?? p.userId.slice(0, 8)}
                    </div>
                  </div>
                ))}
```

Change to:

```tsx
                {/* Remote thumbnails */}
                {participants.map((p) => (
                  <RemoteParticipantTile
                    key={p.userId}
                    participant={p}
                    displayName={userCache.get(p.userId) ?? p.userId.slice(0, 8)}
                    muted={remoteMicMuted.get(p.userId) ?? false}
                    isSharing={screenSharers.has(p.userId)}
                    layout="thumbnail"
                    isFocused={focusedUserId === p.userId}
                    onFocus={() => setFocusedUserId(p.userId)}
                    videoRefSetter={(el) => { if (el) remoteVideoRefs.current.set(p.userId, el); }}
                  />
                ))}
```

- [ ] **Step 9: Use `RemoteParticipantTile` in the video grid**

`GroupCallUI.tsx:739-762` currently:

```tsx
              {/* Remote videos */}
              {participants.map((p) => (
                <div key={p.userId} className={`video-tile ${!p.stream ? 'video-off' : ''}`}>
                  <video
                    ref={(el) => { if (el) remoteVideoRefs.current.set(p.userId, el); }}
                    autoPlay
                    playsInline
                  />
                  {!p.stream && <div className="video-off-placeholder">📷</div>}
                  {screenSharers.has(p.userId) && (
                    <div className="screen-share-badge">🖥 Sharing</div>
                  )}
                  <button
                    className="focus-btn"
                    onClick={() => setFocusedUserId(p.userId)}
                    title="Focus on this participant"
                  >
                    ⛶
                  </button>
                  <div className="video-label">
                    {userCache.get(p.userId) ?? p.userId.slice(0, 8)}
                  </div>
                </div>
              ))}
```

Change to:

```tsx
              {/* Remote videos */}
              {participants.map((p) => (
                <RemoteParticipantTile
                  key={p.userId}
                  participant={p}
                  displayName={userCache.get(p.userId) ?? p.userId.slice(0, 8)}
                  muted={remoteMicMuted.get(p.userId) ?? false}
                  isSharing={screenSharers.has(p.userId)}
                  layout="grid"
                  onFocus={() => setFocusedUserId(p.userId)}
                  videoRefSetter={(el) => { if (el) remoteVideoRefs.current.set(p.userId, el); }}
                />
              ))}
```

- [ ] **Step 10: Replace local tile's `mic-dot` with `mic-badge`, in both grid and thumbnail local tiles**

`GroupCallUI.tsx:676-695` (local thumbnail, inside the focused/screen-share view) currently:

```tsx
                <div
                  className="thumbnail-tile"
                  title={`${user?.username ?? ''} (You)`}
                >
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={isScreenSharing ? 'local-video-screen' : 'local-video'}
                  />
                  {isVideoOff && !isScreenSharing && (
                    <div className="thumbnail-placeholder">📷</div>
                  )}
                  {isScreenSharing && <div className="thumbnail-badge">🖥</div>}
                  <div className="thumbnail-label">
                    {!isMuted && micLevel > 0.05 && <span className="mic-dot" />}
                    {user?.username} (You)
                  </div>
                </div>
```

Change to:

```tsx
                <div
                  className={`thumbnail-tile ${micLevel > 0.05 ? 'speaking' : ''}`}
                  title={`${user?.username ?? ''} (You)`}
                >
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={isScreenSharing ? 'local-video-screen' : 'local-video'}
                  />
                  {isVideoOff && !isScreenSharing && (
                    <div className="thumbnail-placeholder">📷</div>
                  )}
                  {isScreenSharing && <div className="thumbnail-badge">🖥</div>}
                  <div className={`mic-badge ${isMuted ? 'mic-badge--muted' : micLevel > 0.05 ? 'mic-badge--speaking' : 'mic-badge--idle'}`}>
                    {isMuted ? '🔇' : '🎤'}
                  </div>
                  <div className="thumbnail-label">
                    {user?.username} (You)
                  </div>
                </div>
```

`GroupCallUI.tsx:722-737` (local grid tile) currently:

```tsx
              <div className={`video-tile ${isVideoOff && !isScreenSharing ? 'video-off' : ''} ${micLevel > 0.05 ? 'speaking' : ''}`}>
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={isScreenSharing ? 'local-video-screen' : 'local-video'}
                />
                {isVideoOff && !isScreenSharing && <div className="video-off-placeholder">📷</div>}
                {isScreenSharing && <div className="screen-share-badge">🖥 Sharing</div>}
                <div className="video-label">
                  {!isMuted && micLevel > 0.05 && <span className="mic-dot" />}
                  {user?.username} (You)
                </div>
              </div>
```

Change to:

```tsx
              <div className={`video-tile ${isVideoOff && !isScreenSharing ? 'video-off' : ''} ${micLevel > 0.05 ? 'speaking' : ''}`}>
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={isScreenSharing ? 'local-video-screen' : 'local-video'}
                />
                {isVideoOff && !isScreenSharing && <div className="video-off-placeholder">📷</div>}
                {isScreenSharing && <div className="screen-share-badge">🖥 Sharing</div>}
                <div className={`mic-badge ${isMuted ? 'mic-badge--muted' : micLevel > 0.05 ? 'mic-badge--speaking' : 'mic-badge--idle'}`}>
                  {isMuted ? '🔇' : '🎤'}
                </div>
                <div className="video-label">
                  {user?.username} (You)
                </div>
              </div>
```

- [ ] **Step 11: Verify types**

Run: `cd client && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 12: Manual smoke check**

Run: `npm run dev:vite` (from `client/`), open 3+ browser profiles/windows logged in as different users, join the same voice channel.
Expected:
- A participant who joins after others already muted someone sees the red 🔇 badge immediately (no need to wait for that person to toggle again).
- Whoever is talking gets a pulsing green badge + green tile glow, distinguishing them from the other (silent/gray) tiles — works with 3+ simultaneous participants.
- Switching to the screen-share focused view (thumbnail strip) shows the same badges, correctly sized.
- Own tile (grid and thumbnail) shows the same badge style as everyone else's.

- [ ] **Step 13: Commit**

```bash
git add client/src/components/GroupCallUI.tsx client/src/components/GroupCallUI.css
git commit -m "feat(group-call): show remote mic mute status and speaking indicator per tile"
```

---

## Self-Review

**Spec coverage:**
- Mute broadcast via WS mirroring `screen_share_*` → Task 1
- Re-announce on `onPeerJoined` to close the late-joiner gap → Task 4 Step 5
- No special reconnect handling (relies on `onPeerJoined` firing for the rejoining peer on other clients) → confirmed no extra code added, matches spec
- VAD reused for remote streams via subcomponent → Task 4 Step 3
- 3-state badge (muted/speaking/idle), bottom-right, priority muted > speaking > idle → Tasks 3 & 4
- Local tile unified to the same badge → Task 3 Step 7, Task 4 Step 10
- 🔇 reused (not 🚫) → used consistently in all render steps
- No new tests, matching untested `screen_share_*` precedent → Task 1 Step 3, Task 3/4 verification steps use `tsc --noEmit` + manual QA only
- Both `CallUI.tsx` (1-on-1) and `GroupCallUI.tsx` (group) covered → Tasks 3 and 4 respectively

**Placeholder scan:** no TBD/TODO; every step shows exact before/after code.

**Type consistency:** `remoteMicMuted` is `Map<string, boolean>` in `GroupCallUI.tsx` (multiple participants) vs plain `boolean` in `CallUI.tsx` (single peer) — intentional, matches the spec's explicit distinction; `RemoteParticipantTileProps.videoRefSetter` signature `(el: HTMLVideoElement | null) => void` matches the existing inline ref-callback pattern being replaced (`(el) => { if (el) ... }`) in both call sites.
