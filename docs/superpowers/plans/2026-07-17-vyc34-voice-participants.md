# VYC-34 — Voice Channel Participants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show live participant count and names under each voice channel in the sidebar (`General (3)` + expanded list of avatars/names), visible to every server member in real time, not just call participants.

**Architecture:** Push-based presence tracking added to the existing main WS hub (`server/internal/delivery/ws/hub.go`), symmetric to the existing `online_users`/`user_joined`/`user_left` pattern. Clients emit `voice_joined`/`voice_left` at existing group-call lifecycle hooks; the hub maintains a `channelID → set(userID)` roster, broadcasts `voice_participants` deltas, and sends a `voice_state` snapshot on connect. The client mirrors this into a `channelId → userId[]` map in `AppPage.tsx`, resolves names from the already-loaded server member list, and renders it in `ChannelSidebar.tsx`.

**Tech Stack:** Go (hub/handler, `gorilla/websocket`, `google/uuid`, `testify`), React + TypeScript (Zustand stores, existing `wsService` pub/sub client).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-17-vyc34-voice-participants-design.md` — every requirement below traces back to it.
- No new dependencies (Go or npm) — everything is buildable with what's already imported in the touched files.
- UI copy stays in English, matching existing sidebar strings (`Text Channels`, `Voice Channels`) — this feature adds no new user-facing text beyond dynamic numbers/names, so no translation decision is needed.
- Client has **no unit test runner** configured (no vitest/jest — only a separate `e2e/run.sh` script, out of scope here). Client tasks are verified via `npm run build:vite` (tsc type-check + build) plus manual browser QA, not automated tests. Go tasks follow full TDD (`go test`).
- Go commands (run from repo root): `make test` (`cd server && go test -v ./...`), `make fmt`, `make vet`.
- Follow existing patterns: Hub state is protected by `h.mu sync.RWMutex`; any new Hub method that touches `voiceChannels`/`clientVoiceChannel` must lock it. Message payloads sent directly on `client.Send` (bypassing the `Message` struct) must wrap nested marshaled JSON in `json.RawMessage(...)` — see `sendOnlineUsersToClient` in hub.go for the reference pattern (skipping this wrapping silently base64-encodes the nested payload).

---

## Task 1: Hub — voice-channel roster data structures

**Files:**
- Modify: `server/internal/delivery/ws/hub.go`
- Test: `server/internal/delivery/ws/hub_test.go` (new)

**Interfaces:**
- Produces: `Hub.JoinVoiceChannel(userID, channelID uuid.UUID) []uuid.UUID`, `Hub.LeaveVoiceChannel(userID uuid.UUID) (channelID uuid.UUID, participants []uuid.UUID, ok bool)`, `Hub.GetVoiceState() map[uuid.UUID][]uuid.UUID`, and unexported `Hub.voiceStateLocked() map[uuid.UUID][]uuid.UUID` / `Hub.voiceParticipantsLocked(channelID uuid.UUID) []uuid.UUID` (caller must hold `h.mu`) — consumed by Task 2.

This task only adds the data layer (no wiring into `Run()`, no WS events yet) so it can be tested in complete isolation.

- [ ] **Step 1: Write the failing tests**

Create `server/internal/delivery/ws/hub_test.go`:

```go
package ws

import (
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
)

func newTestHub() *Hub {
	return NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func TestJoinVoiceChannel_AddsParticipant(t *testing.T) {
	h := newTestHub()
	userID := uuid.New()
	channelID := uuid.New()

	participants := h.JoinVoiceChannel(userID, channelID)

	assert.Equal(t, []uuid.UUID{userID}, participants)
}

func TestJoinVoiceChannel_MovesUserBetweenChannels(t *testing.T) {
	h := newTestHub()
	userID := uuid.New()
	channelA := uuid.New()
	channelB := uuid.New()

	h.JoinVoiceChannel(userID, channelA)
	participantsB := h.JoinVoiceChannel(userID, channelB)

	assert.Equal(t, []uuid.UUID{userID}, participantsB)
	state := h.GetVoiceState()
	_, stillInA := state[channelA]
	assert.False(t, stillInA, "user should be removed from the previous channel")
}

func TestLeaveVoiceChannel_RemovesParticipant(t *testing.T) {
	h := newTestHub()
	userID := uuid.New()
	channelID := uuid.New()
	h.JoinVoiceChannel(userID, channelID)

	gotChannelID, participants, ok := h.LeaveVoiceChannel(userID)

	assert.True(t, ok)
	assert.Equal(t, channelID, gotChannelID)
	assert.Empty(t, participants)
}

func TestLeaveVoiceChannel_IdempotentOnSecondCall(t *testing.T) {
	h := newTestHub()
	userID := uuid.New()
	channelID := uuid.New()
	h.JoinVoiceChannel(userID, channelID)
	h.LeaveVoiceChannel(userID)

	_, _, ok := h.LeaveVoiceChannel(userID)

	assert.False(t, ok, "second Leave call must be a no-op")
}

func TestGetVoiceState_ReturnsOnlyNonEmptyChannels(t *testing.T) {
	h := newTestHub()
	userA := uuid.New()
	userB := uuid.New()
	channelID := uuid.New()
	h.JoinVoiceChannel(userA, channelID)
	h.JoinVoiceChannel(userB, channelID)

	state := h.GetVoiceState()

	assert.ElementsMatch(t, []uuid.UUID{userA, userB}, state[channelID])
	assert.Len(t, state, 1)
}
```

- [ ] **Step 2: Run tests to verify they fail (compile error — methods don't exist yet)**

Run: `cd server && go test ./internal/delivery/ws/... -run TestJoinVoiceChannel -v`
Expected: FAIL — `h.JoinVoiceChannel undefined` (compile error)

- [ ] **Step 3: Add the roster fields and methods to hub.go**

In `server/internal/delivery/ws/hub.go`, add two fields to the `Hub` struct (after `broadcast chan *Message`):

```go
type Hub struct {
	clients            map[uuid.UUID]*Client
	register           chan *Client
	unregister         chan *Client
	broadcast          chan *Message
	voiceChannels      map[uuid.UUID]map[uuid.UUID]struct{} // channelID → set(userID)
	clientVoiceChannel map[uuid.UUID]uuid.UUID               // userID → channelID
	mu                 sync.RWMutex
	log                *slog.Logger
}
```

Update `NewHub` to initialize them:

```go
func NewHub(log *slog.Logger) *Hub {
	return &Hub{
		clients:            make(map[uuid.UUID]*Client),
		register:           make(chan *Client),
		unregister:         make(chan *Client),
		broadcast:          make(chan *Message),
		voiceChannels:      make(map[uuid.UUID]map[uuid.UUID]struct{}),
		clientVoiceChannel: make(map[uuid.UUID]uuid.UUID),
		log:                log,
	}
}
```

Add these methods anywhere after `IsOnline` (e.g. right before `RegisterClient`):

```go
// JoinVoiceChannel registers userID as present in the given voice channel,
// moving it out of any previous voice channel first. Returns the updated
// participant list for channelID.
func (h *Hub) JoinVoiceChannel(userID, channelID uuid.UUID) []uuid.UUID {
	h.mu.Lock()
	defer h.mu.Unlock()

	if prevChannelID, ok := h.clientVoiceChannel[userID]; ok {
		delete(h.voiceChannels[prevChannelID], userID)
		if len(h.voiceChannels[prevChannelID]) == 0 {
			delete(h.voiceChannels, prevChannelID)
		}
	}

	if h.voiceChannels[channelID] == nil {
		h.voiceChannels[channelID] = make(map[uuid.UUID]struct{})
	}
	h.voiceChannels[channelID][userID] = struct{}{}
	h.clientVoiceChannel[userID] = channelID

	return h.voiceParticipantsLocked(channelID)
}

// LeaveVoiceChannel removes userID from whatever voice channel it is
// currently in. ok is false if the user was not in any voice channel —
// safe to call repeatedly (e.g. voluntary leave followed by SFU teardown).
func (h *Hub) LeaveVoiceChannel(userID uuid.UUID) (channelID uuid.UUID, participants []uuid.UUID, ok bool) {
	h.mu.Lock()
	defer h.mu.Unlock()

	channelID, ok = h.clientVoiceChannel[userID]
	if !ok {
		return uuid.Nil, nil, false
	}

	delete(h.clientVoiceChannel, userID)
	delete(h.voiceChannels[channelID], userID)
	if len(h.voiceChannels[channelID]) == 0 {
		delete(h.voiceChannels, channelID)
	}

	return channelID, h.voiceParticipantsLocked(channelID), true
}

// GetVoiceState returns a snapshot of all non-empty voice channels and their participants.
func (h *Hub) GetVoiceState() map[uuid.UUID][]uuid.UUID {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.voiceStateLocked()
}

// voiceParticipantsLocked returns the participant list for channelID.
// Caller must hold h.mu.
func (h *Hub) voiceParticipantsLocked(channelID uuid.UUID) []uuid.UUID {
	set := h.voiceChannels[channelID]
	ids := make([]uuid.UUID, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	return ids
}

// voiceStateLocked returns a snapshot of all non-empty voice channels.
// Caller must hold h.mu (read or write lock).
func (h *Hub) voiceStateLocked() map[uuid.UUID][]uuid.UUID {
	state := make(map[uuid.UUID][]uuid.UUID, len(h.voiceChannels))
	for channelID := range h.voiceChannels {
		state[channelID] = h.voiceParticipantsLocked(channelID)
	}
	return state
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && go test ./internal/delivery/ws/... -v`
Expected: PASS — all 5 new tests green, plus no regression in any other test in that package.

- [ ] **Step 5: Format, vet, commit**

```bash
make fmt
make vet
git add server/internal/delivery/ws/hub.go server/internal/delivery/ws/hub_test.go
git commit -m "feat(hub): add voice-channel roster tracking to Hub"
```

---

## Task 2: Hub — wire roster into connect/disconnect lifecycle

**Files:**
- Modify: `server/internal/delivery/ws/hub.go`
- Test: `server/internal/delivery/ws/hub_test.go`

**Interfaces:**
- Consumes: `Hub.JoinVoiceChannel`, `Hub.LeaveVoiceChannel`, `Hub.voiceStateLocked`, `Hub.voiceParticipantsLocked` (Task 1); `Hub.BroadcastMessage`, `Hub.getOnlineUserIDsLocked`, `Hub.sendOnlineUsersToClient` (pre-existing).
- Produces: `Hub.sendVoiceStateToClient(client *Client, state map[uuid.UUID][]uuid.UUID)`, `Hub.BroadcastVoiceParticipants(channelID uuid.UUID, participants []uuid.UUID)` — consumed by Task 3 and by `Run()` itself.

- [ ] **Step 1: Write the failing tests**

Append to `server/internal/delivery/ws/hub_test.go` (add `"strings"` and `"time"` to the import block):

```go
func TestRegisterClient_ReceivesVoiceStateSnapshot(t *testing.T) {
	h := newTestHub()
	go h.Run()

	existingUserID := uuid.New()
	channelID := uuid.New()
	h.JoinVoiceChannel(existingUserID, channelID)

	newUserID := uuid.New()
	client := &Client{UserID: newUserID, Send: make(chan []byte, 8)}
	h.RegisterClient(client)

	found := false
	deadline := time.After(time.Second)
	for !found {
		select {
		case msg := <-client.Send:
			if strings.Contains(string(msg), `"voice_state"`) && strings.Contains(string(msg), channelID.String()) {
				found = true
			}
		case <-deadline:
			t.Fatal("timed out waiting for voice_state snapshot")
		}
	}
}

func TestUnregisterClient_LeavesVoiceChannel(t *testing.T) {
	h := newTestHub()
	go h.Run()

	userID := uuid.New()
	channelID := uuid.New()
	client := &Client{UserID: userID, Send: make(chan []byte, 8)}

	h.RegisterClient(client)
	assert.Eventually(t, func() bool { return h.IsOnline(userID) }, time.Second, 10*time.Millisecond)

	h.JoinVoiceChannel(userID, channelID)
	h.UnregisterClient(client)

	assert.Eventually(t, func() bool {
		_, ok := h.GetVoiceState()[channelID]
		return !ok
	}, time.Second, 10*time.Millisecond, "disconnect should remove the user from its voice channel")
}

func TestUnregister_BroadcastsVoiceParticipantsToOtherClients(t *testing.T) {
	h := newTestHub()
	go h.Run()

	channelID := uuid.New()
	userA := uuid.New()
	userB := uuid.New()

	clientA := &Client{UserID: userA, Send: make(chan []byte, 8)}
	clientB := &Client{UserID: userB, Send: make(chan []byte, 8)}
	h.RegisterClient(clientA)
	h.RegisterClient(clientB)
	assert.Eventually(t, func() bool { return h.IsOnline(userA) && h.IsOnline(userB) },
		time.Second, 10*time.Millisecond)

	h.JoinVoiceChannel(userA, channelID)
	h.UnregisterClient(clientA)

	found := false
	deadline := time.After(time.Second)
	for !found {
		select {
		case msg := <-clientB.Send:
			if strings.Contains(string(msg), `"voice_participants"`) && strings.Contains(string(msg), channelID.String()) {
				found = true
			}
		case <-deadline:
			t.Fatal("client B did not receive a voice_participants broadcast after A disconnected")
		}
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && go test ./internal/delivery/ws/... -run "VoiceState|LeavesVoiceChannel|BroadcastsVoiceParticipants" -v`
Expected: FAIL — new client never receives a `voice_state` message, and disconnect never cleans up the roster (because `Run()` isn't wired yet).

- [ ] **Step 3: Add the two new Hub methods**

In `server/internal/delivery/ws/hub.go`, add near `sendOnlineUsersToClient`:

```go
func (h *Hub) sendVoiceStateToClient(client *Client, state map[uuid.UUID][]uuid.UUID) {
	channels := make(map[string][]string, len(state))
	for channelID, userIDs := range state {
		ids := make([]string, len(userIDs))
		for i, id := range userIDs {
			ids[i] = id.String()
		}
		channels[channelID.String()] = ids
	}
	payload := mustMarshal(map[string]interface{}{
		"channels": channels,
	})
	select {
	case client.Send <- mustMarshal(map[string]interface{}{
		"type":    "voice_state",
		"payload": json.RawMessage(payload),
	}):
	default:
	}
}

// BroadcastVoiceParticipants notifies all connected clients about the current
// participant list for a voice channel.
func (h *Hub) BroadcastVoiceParticipants(channelID uuid.UUID, participants []uuid.UUID) {
	ids := make([]string, len(participants))
	for i, id := range participants {
		ids[i] = id.String()
	}
	h.BroadcastMessage(&Message{
		Type: "voice_participants",
		Payload: mustMarshal(map[string]interface{}{
			"channel_id": channelID.String(),
			"user_ids":   ids,
		}),
	})
}
```

- [ ] **Step 4: Wire the roster into `Run()`**

Replace the entire body of `func (h *Hub) Run()` in `server/internal/delivery/ws/hub.go` with:

```go
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client.UserID] = client
			currentIDs := h.getOnlineUserIDsLocked()
			voiceState := h.voiceStateLocked()
			h.mu.Unlock()
			h.log.Info("client connected", "user_id", client.UserID, "total", len(h.clients))

			// Send online users list and current voice-channel roster to the newly connected client
			h.sendOnlineUsersToClient(client, currentIDs)
			h.sendVoiceStateToClient(client, voiceState)

			// Notify all other clients about the new online user
			h.notifyAllOnlineUsers(client.UserID.String())

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.UserID]; ok {
				delete(h.clients, client.UserID)
				close(client.Send)
				currentIDs := h.getOnlineUserIDsLocked()
				h.mu.Unlock()
				h.log.Info("client disconnected", "user_id", client.UserID, "total", len(h.clients))

				// Notify all clients about the disconnected user
				h.notifyAllOnlineUsersAfterDisconnect(client.UserID.String(), currentIDs)

				// Clean up voice-channel presence left behind by an unexpected disconnect
				if channelID, participants, ok := h.LeaveVoiceChannel(client.UserID); ok {
					h.BroadcastVoiceParticipants(channelID, participants)
				}
			} else {
				h.mu.Unlock()
			}

		case message := <-h.broadcast:
			h.mu.RLock()
			for _, client := range h.clients {
				select {
				case client.Send <- mustMarshal(message):
				default:
					close(client.Send)
					delete(h.clients, client.UserID)
				}
			}
			h.mu.RUnlock()
		}
	}
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && go test ./internal/delivery/ws/... -v`
Expected: PASS — all tests from Task 1 and Task 2 green.

- [ ] **Step 6: Format, vet, commit**

```bash
make fmt
make vet
git add server/internal/delivery/ws/hub.go server/internal/delivery/ws/hub_test.go
git commit -m "feat(hub): send voice_state snapshot on connect, clean up roster on disconnect"
```

---

## Task 3: WS handler — `voice_joined` / `voice_left` routes

**Files:**
- Modify: `server/internal/delivery/http/handler/websocket.go`
- Test: `server/internal/delivery/http/handler/websocket_test.go`

**Interfaces:**
- Consumes: `hub.JoinVoiceChannel`, `hub.LeaveVoiceChannel`, `hub.BroadcastVoiceParticipants` (Task 1/2).
- Produces: nothing new consumed by later tasks — this is the last server-side task; the client (Task 4+) talks to it purely over the wire (`voice_joined`/`voice_left`/`voice_participants`/`voice_state` message types).

- [ ] **Step 1: Write the failing tests**

Add to `server/internal/delivery/http/handler/websocket_test.go`. First add `"encoding/json"` to the import block (alongside the existing `"io"`, `"log/slog"`, ...). Then append these helpers and tests:

```go
// --- Multi-user test harness (for tests needing more than one distinct user) ---

func newMultiUserTestHandler(t *testing.T, users map[string]*domain.User) (*WebSocketHandler, *ws.Hub) {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))

	auth := &mockAuthUseCase{}
	for token, user := range users {
		auth.On("ValidateToken", token).Return(user, nil)
	}

	userUC := &mockUserUseCase{}
	userUC.On("UpdateStatus", mock.Anything, mock.Anything).Return(nil)

	calls := &mockCallUseCase{}
	calls.On("EndAllActiveCalls", mock.Anything).Return(nil)

	hub := ws.NewHub(log)
	go hub.Run()

	h := NewWebSocketHandler(hub, auth, calls, userUC, log)
	h.pongWait = 200 * time.Millisecond
	h.pingPeriod = 80 * time.Millisecond
	h.writeWait = 100 * time.Millisecond

	return h, hub
}

func dialWSWithToken(t *testing.T, srv *httptest.Server, token string) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/?token=" + token
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return conn
}

func sendJSON(t *testing.T, conn *websocket.Conn, msgType string, payload interface{}) {
	t.Helper()
	p, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	msg := ws.Message{Type: msgType, Payload: p}
	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal message: %v", err)
	}
	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		t.Fatalf("write message: %v", err)
	}
}

func readUntilType(t *testing.T, conn *websocket.Conn, wantType string, timeout time.Duration) []byte {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		conn.SetReadDeadline(deadline)
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("did not receive %q message before timeout: %v", wantType, err)
		}
		var msg ws.Message
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		if msg.Type == wantType {
			return data
		}
	}
}

// --- Tests ---

func TestVoiceJoinedBroadcastsParticipants(t *testing.T) {
	userA := uuid.New()
	userB := uuid.New()
	channelID := uuid.New()

	h, _ := newMultiUserTestHandler(t, map[string]*domain.User{
		"token-a": {ID: userA, Username: "alice", Email: "a@e.st", Status: domain.StatusOffline},
		"token-b": {ID: userB, Username: "bob", Email: "b@e.st", Status: domain.StatusOffline},
	})

	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()

	connA := dialWSWithToken(t, srv, "token-a")
	defer connA.Close()
	connB := dialWSWithToken(t, srv, "token-b")
	defer connB.Close()

	sendJSON(t, connA, "voice_joined", map[string]string{"channel_id": channelID.String()})

	msg := readUntilType(t, connB, "voice_participants", 2*time.Second)
	assert.Contains(t, string(msg), channelID.String())
	assert.Contains(t, string(msg), userA.String())
}

func TestVoiceLeftBroadcastsParticipants(t *testing.T) {
	userA := uuid.New()
	userB := uuid.New()
	channelID := uuid.New()

	h, hub := newMultiUserTestHandler(t, map[string]*domain.User{
		"token-a": {ID: userA, Username: "alice", Email: "a@e.st", Status: domain.StatusOffline},
		"token-b": {ID: userB, Username: "bob", Email: "b@e.st", Status: domain.StatusOffline},
	})

	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()

	connA := dialWSWithToken(t, srv, "token-a")
	defer connA.Close()
	connB := dialWSWithToken(t, srv, "token-b")
	defer connB.Close()

	assert.Eventually(t, func() bool { return hub.IsOnline(userA) && hub.IsOnline(userB) },
		time.Second, 10*time.Millisecond)

	hub.JoinVoiceChannel(userA, channelID)

	sendJSON(t, connA, "voice_left", map[string]string{"channel_id": channelID.String()})

	msg := readUntilType(t, connB, "voice_participants", 2*time.Second)
	assert.Contains(t, string(msg), channelID.String())
	assert.NotContains(t, string(msg), userA.String())
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && go test ./internal/delivery/http/handler/... -run "TestVoiceJoined|TestVoiceLeft" -v`
Expected: FAIL — timeout waiting for `voice_participants` (server currently logs "unknown message type" and does nothing).

- [ ] **Step 3: Add the handlers**

In `server/internal/delivery/http/handler/websocket.go`, add two new cases to the `handleMessage` switch (right after `case "screen_share_stopped":`):

```go
	case "voice_joined":
		h.handleVoiceJoined(client, msg)
	case "voice_left":
		h.handleVoiceLeft(client, msg)
```

Add the handler functions near `handleJoinChannel`:

```go
func (h *WebSocketHandler) handleVoiceJoined(client *ws.Client, msg *ws.Message) {
	var payload struct {
		ChannelID string `json:"channel_id"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return
	}
	channelID, err := uuid.Parse(payload.ChannelID)
	if err != nil {
		return
	}

	participants := h.hub.JoinVoiceChannel(client.UserID, channelID)
	h.log.Info("voice channel joined", "user_id", client.UserID, "channel_id", channelID)
	h.hub.BroadcastVoiceParticipants(channelID, participants)
}

// handleVoiceLeft ignores the message body — the hub already knows which
// channel client.UserID is in, so it's the sole source of truth for "which
// channel did they leave" (protects against a stale/mismatched channel_id
// in the payload).
func (h *WebSocketHandler) handleVoiceLeft(client *ws.Client, _ *ws.Message) {
	channelID, participants, ok := h.hub.LeaveVoiceChannel(client.UserID)
	if !ok {
		return
	}
	h.log.Info("voice channel left", "user_id", client.UserID, "channel_id", channelID)
	h.hub.BroadcastVoiceParticipants(channelID, participants)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && go test ./internal/delivery/http/handler/... -v`
Expected: PASS — all tests in the package green, including the two new ones and the pre-existing `TestDeadClientIsCleanedUp`/`TestLiveClientStaysOnline`.

- [ ] **Step 5: Full server test suite, format, vet, commit**

```bash
make test
make fmt
make vet
git add server/internal/delivery/http/handler/websocket.go server/internal/delivery/http/handler/websocket_test.go
git commit -m "feat(ws): route voice_joined/voice_left messages to the hub roster"
```

---

## Task 4: Client — emit `voice_joined` / `voice_left` at call lifecycle points

**Files:**
- Modify: `client/src/components/GroupCallUI.tsx`

**Interfaces:**
- Consumes: `wsService.send(type: string, payload: unknown)` (existing), `groupCallService.currentRoomIdState: string` (existing, never cleared by `leaveGroupCall()`/`teardown()` — safe to read at any point before the next `joinGroupCall()` call).
- Produces: WS traffic `voice_joined {channel_id}` / `voice_left {channel_id}` — consumed server-side by Task 3, and by Task 5's client-side subscriber (indirectly, via other clients' hub state).

No test runner is available for this file; verification is a type-check build plus a manual WS-traffic check.

- [ ] **Step 1: Send `voice_joined` after a successful join**

In `client/src/components/GroupCallUI.tsx`, replace `handleJoinGroupCall`:

```tsx
  const handleJoinGroupCall = useCallback(async (roomId: string): Promise<boolean> => {
    if (!user) return false;
    const isFirst = await groupCallService.joinGroupCall(roomId, user.id);
    // currentRoomIdState only equals roomId if joinGroupCall actually proceeded
    // past its "already in a call" guard — skips the send on that error path.
    if (groupCallService.currentRoomIdState === roomId) {
      wsService.send('voice_joined', { channel_id: roomId });
    }
    setIsInGroupCall(true);
    const micAvailable = groupCallService.isMicrophoneAvailable;
    setIsMicAvailable(micAvailable);
    if (!micAvailable) setIsMuted(true);
    return isFirst;
  }, [user]);
```

- [ ] **Step 2: Send `voice_left` on voluntary leave**

Replace `handleLeaveGroupCall`:

```tsx
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
```

- [ ] **Step 3: Send `voice_left` on unexpected call end and on error**

In the `groupCallService.init({...})` block, update `onCallEnded` and `onError`:

```tsx
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

- [ ] **Step 4: Type-check and build**

Run: `cd client && npm run build:vite`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Manual verification**

Run `cd client && npm run dev:vite`, open the app in two browser profiles/tabs logged in as two different users on the same server, open DevTools → Network → WS on one tab.
- Join a voice channel → confirm an outgoing `voice_joined` frame with the correct `channel_id`.
- Leave the voice channel via the UI button → confirm an outgoing `voice_left` frame.
- Close the tab while in a call (don't click leave) → the other tab's WS frames (checked in Task 6) should still reflect the departure once the server times out the dead connection (covered by Task 2's disconnect cleanup).

- [ ] **Step 6: Commit**

```bash
git add client/src/components/GroupCallUI.tsx
git commit -m "feat(client): emit voice_joined/voice_left at group-call lifecycle points"
```

---

## Task 5: Client — track voice participants in `AppPage.tsx`

**Files:**
- Modify: `client/src/pages/AppPage.tsx`

**Interfaces:**
- Consumes: `wsService.on(type: string, listener: (payload: unknown) => void): () => void` (existing); server payload shapes `voice_state: { channels: Record<string, string[]> }` and `voice_participants: { channel_id: string, user_ids: string[] }` (Task 2/3).
- Produces: `voiceParticipants: Map<string, string[]>` state and `members: MemberWithUser[]` (now destructured from the store) — both passed as new props `voiceParticipants` and `members` to `<ChannelSidebar>`, consumed by Task 6.

- [ ] **Step 1: Destructure `members` from the server store**

In `client/src/pages/AppPage.tsx`, update the store destructuring (around line 74):

```tsx
  const { servers, setServers, setCurrentServer, currentServer, setChannels, channels, currentChannel, setCurrentChannel, setMembers, members } = useServerStore();
```

- [ ] **Step 2: Add `voiceParticipants` state**

Add right after the existing `callNotif` state declaration:

```tsx
  const [callNotif, setCallNotif] = useState<CallNotif | null>(null);
  const [voiceParticipants, setVoiceParticipants] = useState<Map<string, string[]>>(new Map());
```

- [ ] **Step 3: Subscribe to `voice_state` and `voice_participants`**

Add a new effect, placed after the existing `voice_call_cancel` subscription effect:

```tsx
  useEffect(() => {
    const unsubState = wsService.on('voice_state', (payload) => {
      const p = payload as { channels: Record<string, string[]> };
      setVoiceParticipants(new Map(Object.entries(p.channels ?? {})));
    });
    const unsubParticipants = wsService.on('voice_participants', (payload) => {
      const p = payload as { channel_id: string; user_ids: string[] };
      setVoiceParticipants((prev) => {
        const next = new Map(prev);
        if (p.user_ids.length === 0) {
          next.delete(p.channel_id);
        } else {
          next.set(p.channel_id, p.user_ids);
        }
        return next;
      });
    });
    return () => { unsubState(); unsubParticipants(); };
  }, []);
```

- [ ] **Step 4: Pass the new props to `ChannelSidebar`**

Update the `<ChannelSidebar>` JSX:

```tsx
        <ChannelSidebar
          server={currentServer}
          channels={channels}
          currentChannel={currentChannel}
          onSelectChannel={handleSelectChannel}
          user={user}
          onLogout={logout}
          onMobileBack={() => setMobilePanel('servers')}
          voiceParticipants={voiceParticipants}
          members={members}
        />
```

- [ ] **Step 5: Type-check and build**

Run: `cd client && npm run build:vite`
Expected: FAILS at this point — `ChannelSidebar` doesn't accept `voiceParticipants`/`members` props yet. This is expected; Task 6 adds them. Confirm the error is specifically about the two new props (not something else), then proceed.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/AppPage.tsx
git commit -m "feat(client): track voice-channel participants from hub WS events"
```

---

## Task 6: Client — render participant count and list in `ChannelSidebar`

**Files:**
- Modify: `client/src/components/ChannelSidebar.tsx`
- Modify: `client/src/components/ChannelSidebar.css`

**Interfaces:**
- Consumes: `voiceParticipants?: Map<string, string[]>` and `members: MemberWithUser[]` props (Task 5).

This is the final, visually observable deliverable — it closes out the type error introduced at the end of Task 5.

- [ ] **Step 1: Update imports and props**

In `client/src/components/ChannelSidebar.tsx`, update the imports and props interface:

```tsx
import { useState, useEffect, useMemo } from 'react';
import type { Server, Channel, User, MemberWithUser } from '@/types';
import { Settings } from '@/components/Settings';
import { noiseCancellationService } from '@/services/noiseCancellation';
import './ChannelSidebar.css';

interface ChannelSidebarProps {
  server: Server | null;
  channels: Channel[];
  currentChannel: Channel | null;
  onSelectChannel: (channel: Channel) => void;
  user: User | null;
  onLogout: () => void;
  onMobileBack?: () => void;
  voiceParticipants?: Map<string, string[]>;
  members: MemberWithUser[];
}
```

Update the function signature:

```tsx
export function ChannelSidebar({
  server,
  channels,
  currentChannel,
  onSelectChannel,
  user,
  onLogout,
  onMobileBack,
  voiceParticipants,
  members,
}: ChannelSidebarProps) {
```

- [ ] **Step 2: Add the username resolver**

Add right after `const [ncEnabled, setNcEnabled] = useState(false);`:

```tsx
  const usernameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.user_id, m.username);
    return map;
  }, [members]);

  const resolveUsername = (userId: string): string => usernameById.get(userId) ?? userId.slice(0, 8);
```

- [ ] **Step 3: Render count + participant list**

Replace the voice channels rendering block:

```tsx
        {voiceChannels.length > 0 && (
          <>
            <div className="channel-category">
              <span>Voice Channels</span>
            </div>
            {voiceChannels.map((channel) => {
              const participantIds = voiceParticipants?.get(channel.id) ?? [];
              return (
                <div key={channel.id} className="voice-channel-group">
                  <div
                    className={`channel voice ${currentChannel?.id === channel.id ? 'active' : ''}`}
                    onClick={() => onSelectChannel(channel)}
                  >
                    {channel.name}
                    {participantIds.length > 0 && (
                      <span className="voice-count">({participantIds.length})</span>
                    )}
                  </div>
                  {participantIds.length > 0 && (
                    <div className="voice-participant-list">
                      {participantIds.map((userId) => (
                        <div
                          key={userId}
                          className={`voice-participant ${userId === user?.id ? 'is-self' : ''}`}
                          onClick={() => onSelectChannel(channel)}
                        >
                          <div className="voice-participant-avatar">
                            {resolveUsername(userId).charAt(0).toUpperCase()}
                          </div>
                          <span className="voice-participant-name">{resolveUsername(userId)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
```

- [ ] **Step 4: Add CSS**

Append to `client/src/components/ChannelSidebar.css`:

```css
/* ── Voice Participants ── */
.voice-count {
  margin-left: 4px;
  font-size: 12px;
  font-weight: 600;
  opacity: 0.6;
}

.voice-participant-list {
  display: flex;
  flex-direction: column;
  padding: 2px 0 6px 30px;
  gap: 2px;
}

.voice-participant {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition);
}

.voice-participant:hover {
  background: var(--bg-hover);
}

.voice-participant-avatar {
  width: 20px;
  height: 20px;
  min-width: 20px;
  border-radius: var(--radius-full);
  background: linear-gradient(135deg, var(--brand-300), var(--brand-500));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-inverse);
}

.voice-participant-name {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.voice-participant.is-self .voice-participant-name {
  color: var(--brand-600);
  font-weight: 700;
}
```

- [ ] **Step 5: Type-check and build**

Run: `cd client && npm run build:vite`
Expected: build succeeds with no TypeScript errors (this also resolves the expected failure left at the end of Task 5, Step 5).

- [ ] **Step 6: Manual end-to-end verification**

Run `cd client && npm run dev:vite`, open two browser profiles logged in as two different users, both members of the same server:

- With neither user in a voice channel: confirm the channel shows just its name, no `(N)` suffix, no participant list.
- User A joins the voice channel: on User B's screen (not in the call), confirm the channel now shows `ChannelName (1)` with a one-row participant list showing A's avatar+name.
- User B joins the same channel: confirm both screens show `(2)` and both names; on each user's own screen, confirm their own row is bold/accent-colored and the other user's is not.
- Click a participant's name from a channel you're not currently in: confirm it joins/switches you into that voice channel (same as clicking the channel row).
- User A closes their tab (not clicking "leave"): confirm User B's list eventually drops back to `(1)` (allow up to `pongWait`, ~60s, for the dead-connection cleanup from Task 2).
- Switch to a different server: confirm no stale participant counts leak onto unrelated channels.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/ChannelSidebar.tsx client/src/components/ChannelSidebar.css
git commit -m "feat(client): render voice-channel participant count and list in sidebar"
```
