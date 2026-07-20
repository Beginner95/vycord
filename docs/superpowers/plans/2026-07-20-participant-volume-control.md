# Per-Participant Volume Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "three dots" button to every remote participant's tile in the group call UI (`GroupCallUI.tsx`), opening a small popover with a 0–100% volume slider that adjusts that participant's audio locally, for the current call only.

**Architecture:** Remote audio already plays through the `<video>` element (`srcObject = remoteStream`), so `HTMLMediaElement.volume` (0.0–1.0) is enough — no Web Audio/GainNode graph needed. A new standalone `VolumeControlPopover` component renders via `createPortal` to `document.body` with `position: fixed`, positioned from the trigger button's `getBoundingClientRect()` — this sidesteps the `overflow: hidden` clipping on `.video-tile`/`.thumbnail-tile` entirely instead of restructuring their DOM. Per-participant volume lives in `GroupCallUI` state (`Record<string, number>`), applied directly to the `<video>` element on both slider drag and stream (re)attachment, and reset whenever call state resets (mirrors the existing `remoteMicMuted` reset pattern).

**Tech Stack:** React 19 + TypeScript (client only), no new dependencies (`react-dom`'s `createPortal` is already used elsewhere via `react-dom/client`).

## Global Constraints

- Volume range 0–100%, default 100% — spec explicitly rejected a Web Audio/GainNode boost path; `video.volume` (0.0–1.0) is sufficient.
- Purely local and per-session — never sent over WS, never written to `localStorage`; resets to 100% for everyone at the start of each new call.
- The button is always visible (not hover-only) — user's explicit choice, unlike `.focus-btn` which is hover-reveal.
- Popover content is only the slider + a percentage readout — no mute button, no extra controls.
- Only one popover open at a time across all tiles.
- No button/popover on the local user's own tile — nothing to control there.
- Group call only (`GroupCallUI.tsx`) — 1-on-1 calls (`CallUI.tsx`) are out of scope.
- No new client test infrastructure — the project has no frontend test framework; verification is `tsc --noEmit` + manual browser QA, per spec.

---

## File Structure

- Create: `client/src/components/VolumeControlPopover.tsx` — standalone popover (slider + %), portal-rendered, closes on outside click/Escape/scroll/resize
- Create: `client/src/components/VolumeControlPopover.css` — popover styling
- Modify: `client/src/components/GroupCallUI.tsx` — `attachStreamToElement` gains a `volume` param; `RemoteParticipantTile` gains the trigger button + popover wiring; `GroupCallUI` gains `participantVolumes`/`volumePopoverUserId` state and `handleVolumeChange`
- Modify: `client/src/components/GroupCallUI.css` — `.volume-btn` (+ thumbnail-sized override)

---

### Task 1: `VolumeControlPopover` component

**Files:**
- Create: `client/src/components/VolumeControlPopover.css`
- Create: `client/src/components/VolumeControlPopover.tsx`

**Interfaces:**
- Produces: `VolumeControlPopover({ value: number; position: { top: number; left: number }; onChange: (value: number) => void; onClose: () => void }): JSX.Element` — consumed by Task 2 from `RemoteParticipantTile`.

- [ ] **Step 1: Create the CSS file**

Create `client/src/components/VolumeControlPopover.css`:

```css
.volume-popover {
  position: fixed;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
  padding: 8px 10px;
  z-index: 1100;
  cursor: default;
}

.volume-popover-slider {
  width: 110px;
}

.volume-popover-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 32px;
  text-align: right;
}
```

`z-index: 1100` matches the existing "above `.group-call-overlay`" convention already used by `.screen-picker-backdrop` (`GroupCallUI.css:402`, overlay itself is `z-index: 1000`).

- [ ] **Step 2: Create the component**

Create `client/src/components/VolumeControlPopover.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './VolumeControlPopover.css';

interface VolumeControlPopoverProps {
  value: number;
  position: { top: number; left: number };
  onChange: (value: number) => void;
  onClose: () => void;
}

export function VolumeControlPopover({ value, position, onChange, onClose }: VolumeControlPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={popoverRef}
      className="volume-popover"
      style={{ top: position.top, left: position.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="volume-popover-slider"
      />
      <span className="volume-popover-value">{value}%</span>
    </div>,
    document.body,
  );
}
```

The outside-click check (`popoverRef.current.contains`) matters here — without it, `mousedown` on the slider itself (needed to start a drag) would immediately close the popover. The `scroll`/`resize` listeners close the popover rather than reposition it, since position is a one-shot snapshot taken at open time (see Task 2) — closing avoids a visually stale popover if the anchor moves (e.g. scrolling the thumbnail strip).

- [ ] **Step 3: Verify types**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (component isn't wired into any UI yet, but must type-check standalone).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/VolumeControlPopover.tsx client/src/components/VolumeControlPopover.css
git commit -m "feat(group-call): add standalone VolumeControlPopover component"
```

---

### Task 2: Wire the volume button + state into `GroupCallUI`

**Files:**
- Modify: `client/src/components/GroupCallUI.tsx:11` (import), `:63-89` (`attachStreamToElement`), `:181-236` (`RemoteParticipantTileProps` + `RemoteParticipantTile`), `:274-281` (new state block), `:296-301` (attach call site 1), `:321-362` (reset points), `:393-397` (attach call site 2), `:527-548` (new callback), `:798-809` and `:836-846` (render call sites)
- Modify: `client/src/components/GroupCallUI.css` (append `.volume-btn` rules)

**Interfaces:**
- Consumes: `VolumeControlPopover` from Task 1.
- Produces: nothing consumed by later tasks — this is the final integration task.

- [ ] **Step 1: Import the popover**

`GroupCallUI.tsx:1-11` currently ends with:

```ts
import type { DesktopCapturerSource } from '@/types/electron';
import './GroupCallUI.css';
```

Change to:

```ts
import type { DesktopCapturerSource } from '@/types/electron';
import { VolumeControlPopover } from './VolumeControlPopover';
import './GroupCallUI.css';
```

- [ ] **Step 2: Add a `volume` parameter to `attachStreamToElement`**

`GroupCallUI.tsx:63-64` currently:

```ts
function attachStreamToElement(el: HTMLVideoElement, stream: MediaStream, userId: string): void {
  el.srcObject = stream;
```

Change to:

```ts
function attachStreamToElement(el: HTMLVideoElement, stream: MediaStream, userId: string, volume: number): void {
  el.srcObject = stream;
  el.volume = volume;
```

- [ ] **Step 3: Add the button + popover to `RemoteParticipantTile`**

`GroupCallUI.tsx:181-236` currently:

```tsx
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

Change to:

```tsx
interface RemoteParticipantTileProps {
  participant: RemoteParticipant;
  displayName: string;
  muted: boolean;
  isSharing: boolean;
  layout: 'grid' | 'thumbnail';
  isFocused?: boolean;
  onFocus: () => void;
  videoRefSetter: (el: HTMLVideoElement | null) => void;
  volume: number;
  isVolumePopoverOpen: boolean;
  onToggleVolumePopover: () => void;
  onCloseVolumePopover: () => void;
  onVolumeChange: (value: number) => void;
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
  volume,
  isVolumePopoverOpen,
  onToggleVolumePopover,
  onCloseVolumePopover,
  onVolumeChange,
}: RemoteParticipantTileProps) {
  const level = useMicLevel(participant.stream, muted);
  const speaking = level > 0.05;
  const micBadgeClass = muted
    ? 'mic-badge--muted'
    : speaking
      ? 'mic-badge--speaking'
      : 'mic-badge--idle';

  const volumeBtnRef = useRef<HTMLButtonElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);

  const handleVolumeBtnClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = volumeBtnRef.current?.getBoundingClientRect();
    if (rect) setPopoverPosition({ top: rect.bottom + 6, left: rect.left });
    onToggleVolumePopover();
  };

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
        <button
          ref={volumeBtnRef}
          className="volume-btn"
          onClick={handleVolumeBtnClick}
          title={`Volume: ${volume}%`}
        >
          ⋮
        </button>
        {isVolumePopoverOpen && popoverPosition && (
          <VolumeControlPopover
            value={volume}
            position={popoverPosition}
            onChange={onVolumeChange}
            onClose={onCloseVolumePopover}
          />
        )}
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
      <button
        ref={volumeBtnRef}
        className="volume-btn"
        onClick={handleVolumeBtnClick}
        title={`Volume: ${volume}%`}
      >
        ⋮
      </button>
      {isVolumePopoverOpen && popoverPosition && (
        <VolumeControlPopover
          value={volume}
          position={popoverPosition}
          onChange={onVolumeChange}
          onClose={onCloseVolumePopover}
        />
      )}
      <div className={`mic-badge ${micBadgeClass}`}>{muted ? '🔇' : '🎤'}</div>
      <div className="video-label">{displayName}</div>
    </div>
  );
}
```

`e.stopPropagation()` in `handleVolumeBtnClick` matters for the thumbnail branch — the tile `<div>` itself has `onClick={onFocus}`, and without it, clicking the volume button would also switch focus. `popoverPosition` is computed fresh from `getBoundingClientRect()` on every click (not just the first), so re-opening after a layout change (e.g. switching grid ↔ focused view) still anchors correctly.

- [ ] **Step 4: Add `.volume-btn` styles**

Append to the end of `client/src/components/GroupCallUI.css` (currently ends at line 912 with `.video-tile .focus-btn:hover`):

```css

/* ── Per-participant volume control ── */
.volume-btn {
  position: absolute;
  top: 8px;
  left: 8px;
  background: rgba(15, 17, 23, 0.72);
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: white;
  border-radius: var(--radius-sm);
  width: 28px;
  height: 28px;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
  transition: background var(--transition);
}

.volume-btn:hover {
  background: rgba(99, 102, 241, 0.8);
}

.thumbnail-tile .volume-btn {
  width: 18px;
  height: 18px;
  top: 4px;
  left: 4px;
  font-size: 11px;
}
```

Top-left placement avoids the existing top-right `.focus-btn`/`.thumbnail-badge` and bottom-right `.mic-badge`. Unlike `.focus-btn`, there's no `opacity: 0` / hover-reveal rule — the button is always visible, per spec.

- [ ] **Step 5: Add `participantVolumes`/`volumePopoverUserId` state**

`GroupCallUI.tsx:274-281` currently:

```ts
  const [remoteMicMuted, setRemoteMicMuted] = useState<Map<string, boolean>>(new Map());

  // Stable ref to isMuted for use in the onPeerJoined WS callback (avoids stale closure)
  const isMutedRef = useRef(isMuted);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);
```

Change to:

```ts
  const [remoteMicMuted, setRemoteMicMuted] = useState<Map<string, boolean>>(new Map());

  // Stable ref to isMuted for use in the onPeerJoined WS callback (avoids stale closure)
  const isMutedRef = useRef(isMuted);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // userId -> 0-100, local-only, never persisted or sent over WS; missing entry means 100 (default)
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>({});
  const [volumePopoverUserId, setVolumePopoverUserId] = useState<string | null>(null);

  // Stable ref to participantVolumes for use in the onRemoteStream WS callback (avoids stale closure)
  const participantVolumesRef = useRef<Record<string, number>>({});

  useEffect(() => {
    participantVolumesRef.current = participantVolumes;
  }, [participantVolumes]);
```

- [ ] **Step 6: Pass volume into both `attachStreamToElement` call sites**

`GroupCallUI.tsx:296-301` (inside `onRemoteStream`, in the `groupCallService.init({...}, [])` effect — this closure is created once at mount, so it must read the ref, not the state directly) currently:

```ts
        // Attach stream to video element if it's already in the DOM.
        // The useEffect below is the fallback for when React re-renders first.
        const videoEl = remoteVideoRefs.current.get(userId);
        if (videoEl && videoEl.srcObject !== stream) {
          attachStreamToElement(videoEl, stream, userId);
        }
```

Change to:

```ts
        // Attach stream to video element if it's already in the DOM.
        // The useEffect below is the fallback for when React re-renders first.
        const videoEl = remoteVideoRefs.current.get(userId);
        if (videoEl && videoEl.srcObject !== stream) {
          attachStreamToElement(videoEl, stream, userId, (participantVolumesRef.current[userId] ?? 100) / 100);
        }
```

`GroupCallUI.tsx:393-397` (inside the "Attach remote streams after React commits" effect, re-created every render — safe to read `participantVolumes` state directly) currently:

```ts
      if (p.stream) {
        if (videoEl && videoEl.srcObject !== p.stream) {
          attachStreamToElement(videoEl, p.stream, p.userId);
        }
      }
```

Change to:

```ts
      if (p.stream) {
        if (videoEl && videoEl.srcObject !== p.stream) {
          attachStreamToElement(videoEl, p.stream, p.userId, (participantVolumes[p.userId] ?? 100) / 100);
        }
      }
```

This is what makes a participant's volume survive their stream dropping and reattaching (e.g. toggling camera) instead of resetting to 100%.

- [ ] **Step 7: Reset volume state alongside the existing `remoteMicMuted` resets**

`GroupCallUI.tsx:321-362` currently:

```ts
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

Change to:

```ts
      onReconnecting: () => {
        setIsReconnecting(true);
        // Participants are re-announced via 'joined'/onPeerJoined after
        // rejoin; clear now so users who left during the outage don't linger.
        setParticipants([]);
        setScreenSharers(new Set());
        setRemoteMicMuted(new Map());
        setParticipantVolumes({});
        setVolumePopoverUserId(null);
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
        setParticipantVolumes({});
        setVolumePopoverUserId(null);
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
        setParticipantVolumes({});
        setVolumePopoverUserId(null);
        setFocusedUserId(null);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        groupCallService.leaveGroupCall();
      },
```

No change needed in `onPeerLeft` — when a participant leaves, `participants` drops them, `RemoteParticipantTile` for that user unmounts, and any open popover for them unmounts along with it. A stale entry left behind in `participantVolumes`/a stale `volumePopoverUserId` pointing at the departed user is harmless (nothing reads it for a user no longer rendered), matching the existing "don't bother explicitly cleaning per-leave" precedent already established for `remoteMicMuted` in this same file.

- [ ] **Step 8: Add `handleVolumeChange`**

`GroupCallUI.tsx:527-548` (`handleLeaveGroupCall`, immediately followed by the `micLevel` hook) currently:

```ts
  const handleLeaveGroupCall = useCallback(() => {
    const channelId = groupCallService.currentRoomIdState;
    if (groupCallService.isScreenSharing) {
      wsService.send('screen_share_stopped', {});
    }
    if (channelId) {
      wsService.send('voice_call_cancel', {
        channel_id: channelId,
        server_id: currentServer?.id,
      });
      wsService.send('voice_left', { channel_id: channelId });
    }
    groupCallService.leaveGroupCall();
    setIsInGroupCall(false);
    setIsReconnecting(false);
    setParticipants([]);
    setIsScreenSharing(false);
    setShowSourcePicker(false);
    setScreenSharers(new Set());
    setFocusedUserId(null);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, [currentServer]);

  const micLevel = useMicLevel(
```

Change to:

```ts
  const handleLeaveGroupCall = useCallback(() => {
    const channelId = groupCallService.currentRoomIdState;
    if (groupCallService.isScreenSharing) {
      wsService.send('screen_share_stopped', {});
    }
    if (channelId) {
      wsService.send('voice_call_cancel', {
        channel_id: channelId,
        server_id: currentServer?.id,
      });
      wsService.send('voice_left', { channel_id: channelId });
    }
    groupCallService.leaveGroupCall();
    setIsInGroupCall(false);
    setIsReconnecting(false);
    setParticipants([]);
    setIsScreenSharing(false);
    setShowSourcePicker(false);
    setScreenSharers(new Set());
    setFocusedUserId(null);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, [currentServer]);

  const handleVolumeChange = useCallback((userId: string, value: number) => {
    setParticipantVolumes((prev) => ({ ...prev, [userId]: value }));
    const videoEl = remoteVideoRefs.current.get(userId);
    if (videoEl) videoEl.volume = value / 100;
  }, []);

  const micLevel = useMicLevel(
```

- [ ] **Step 9: Pass the new props at both `<RemoteParticipantTile>` call sites**

`GroupCallUI.tsx:798-809` (thumbnail strip) currently:

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
                    volume={participantVolumes[p.userId] ?? 100}
                    isVolumePopoverOpen={volumePopoverUserId === p.userId}
                    onToggleVolumePopover={() => setVolumePopoverUserId((prev) => (prev === p.userId ? null : p.userId))}
                    onCloseVolumePopover={() => setVolumePopoverUserId(null)}
                    onVolumeChange={(value) => handleVolumeChange(p.userId, value)}
                  />
                ))}
```

`GroupCallUI.tsx:836-846` (video grid) currently:

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
                  volume={participantVolumes[p.userId] ?? 100}
                  isVolumePopoverOpen={volumePopoverUserId === p.userId}
                  onToggleVolumePopover={() => setVolumePopoverUserId((prev) => (prev === p.userId ? null : p.userId))}
                  onCloseVolumePopover={() => setVolumePopoverUserId(null)}
                  onVolumeChange={(value) => handleVolumeChange(p.userId, value)}
                />
              ))}
```

- [ ] **Step 10: Verify types**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 11: Manual smoke check**

Run: `npm run dev:vite` (from `client/`), open 3+ browser profiles/windows logged in as different users, join the same voice channel.

Expected:
- Every remote participant's tile (grid and thumbnail layout) shows a `⋮` button in the top-left corner; the local user's own tile does not.
- Clicking `⋮` opens a small popover anchored just below the button, containing a slider and a `100%` label.
- Dragging the slider changes that participant's audio volume live, with no effect on other participants' volume.
- Opening a second participant's popover closes the first one automatically.
- Clicking outside the popover, pressing Escape, or scrolling the thumbnail strip closes it.
- Toggling a remote participant's camera off and back on preserves the volume you set for them (does not reset to 100%).
- Leaving the call and rejoining (or joining a different voice channel) resets everyone to 100%.
- Behavior is identical in the normal grid view and the focused/screen-share thumbnail strip.

- [ ] **Step 12: Commit**

```bash
git add client/src/components/GroupCallUI.tsx client/src/components/GroupCallUI.css
git commit -m "feat(group-call): add per-participant volume control"
```

---

## Self-Review

**Spec coverage:**
- `video.volume`, no Web Audio/GainNode, 0–100% range, default 100% → Task 2 Steps 2, 6, 8
- Local-only, not persisted, resets each call → Task 2 Steps 5, 7 (no `localStorage` read/write anywhere; state lives in `useState`)
- Always-visible button (not hover-reveal) → Task 2 Step 4 (`.volume-btn` has no `opacity: 0` rule, unlike `.focus-btn`)
- Small popover anchored to the button → Task 1 (`position: fixed` + `getBoundingClientRect()`), Task 2 Step 3
- Slider + % only, no extra controls → Task 1 Step 2
- Only one popover open at a time → `volumePopoverUserId` is a single value, not a set (Task 2 Step 5, Step 9's toggle handler)
- No control on local tile → local tile JSX is untouched by this plan; only `RemoteParticipantTile` gets the button
- Group call only, `CallUI.tsx` untouched → confirmed, no `CallUI.*` file appears in File Structure
- Volume survives stream re-attach (camera toggle) → Task 2 Step 6
- No test framework, `tsc --noEmit` + manual QA → Task 1 Step 3, Task 2 Steps 10–11

**Placeholder scan:** no TBD/TODO; every step shows exact before/after code.

**Type consistency:** `RemoteParticipantTileProps.volume: number` / `onVolumeChange: (value: number) => void` (Task 2 Step 3) matches the values passed at both call sites in Step 9 (`participantVolumes[p.userId] ?? 100` and `(value) => handleVolumeChange(p.userId, value)`); `VolumeControlPopoverProps.position: { top: number; left: number }` (Task 1) matches `popoverPosition` state's type in `RemoteParticipantTile` (Task 2 Step 3); `attachStreamToElement`'s new `volume: number` parameter (0.0–1.0 scale) is divided from the 0–100 scale at both call sites (Task 2 Step 6), consistent with `handleVolumeChange`'s own `value / 100` conversion (Task 2 Step 8).
