package ws

import (
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

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

// readVoiceStateSnapshot returns the raw voice_state message a freshly
// registered client received, failing the test if none arrives.
func readVoiceStateSnapshot(t *testing.T, client *Client) string {
	t.Helper()
	deadline := time.After(time.Second)
	for {
		select {
		case msg := <-client.Send:
			if strings.Contains(string(msg), `"voice_state"`) {
				return string(msg)
			}
		case <-deadline:
			t.Fatal("timed out waiting for voice_state snapshot")
			return ""
		}
	}
}

// The connect-time snapshot must not hand a private channel's roster to a user
// who is not in its audience — reconnects are routine, so an unfiltered
// snapshot would undo the per-event narrowing entirely.
func TestRegisterClient_VoiceStateSnapshotExcludesPrivateChannels(t *testing.T) {
	h := newTestHub()
	go h.Run()

	allowedChannel := uuid.New()
	deniedChannel := uuid.New()
	publicChannel := uuid.New()
	newUserID := uuid.New()

	h.JoinVoiceChannel(uuid.New(), allowedChannel)
	h.JoinVoiceChannel(uuid.New(), deniedChannel)
	h.JoinVoiceChannel(uuid.New(), publicChannel)

	h.SetVoiceAudienceResolver(func(channelID uuid.UUID) ([]uuid.UUID, error) {
		switch channelID {
		case allowedChannel:
			return []uuid.UUID{newUserID}, nil
		case deniedChannel:
			return []uuid.UUID{uuid.New()}, nil
		default:
			return nil, nil // public
		}
	})

	client := &Client{UserID: newUserID, Send: make(chan []byte, 8)}
	h.RegisterClient(client)

	snapshot := readVoiceStateSnapshot(t, client)
	assert.NotContains(t, snapshot, deniedChannel.String(),
		"private channel the user is not in must not appear in the snapshot")
	assert.Contains(t, snapshot, allowedChannel.String(),
		"private channel the user IS in must still appear")
	assert.Contains(t, snapshot, publicChannel.String(),
		"public channel must still appear")
}

// A resolver failure must fail closed for the snapshot: better a missing
// channel (the next voice_participants event restores it) than a leaked one.
func TestRegisterClient_VoiceStateSnapshotExcludesChannelOnResolverError(t *testing.T) {
	h := newTestHub()
	go h.Run()

	brokenChannel := uuid.New()
	h.JoinVoiceChannel(uuid.New(), brokenChannel)
	h.SetVoiceAudienceResolver(func(uuid.UUID) ([]uuid.UUID, error) {
		return nil, errors.New("db down")
	})

	client := &Client{UserID: uuid.New(), Send: make(chan []byte, 8)}
	h.RegisterClient(client)

	snapshot := readVoiceStateSnapshot(t, client)
	assert.NotContains(t, snapshot, brokenChannel.String(),
		"channel must be excluded when its audience cannot be resolved")
}

// TestUnregisterClient_DoesNotClearVoicePresence is VYC-78 step 4 (8.4): a
// client's app-level WebSocket dying is not the same fact as "left the voice
// call" — it is exactly the SFU-side "WS died but the participant is still in
// the room" case grace-session (step 3) exists to not act on prematurely, just
// on the API's own connection instead of the SFU's. Wiping voice presence here
// used to be a systematically false signal (VYC-78 design doc 8.4): any blip in
// the API WebSocket — unrelated to whether the call itself is still live —
// silently vanished the user from everyone else's sidebar. The reconciliation
// worker (package presence) now owns correcting the REVERSE case: a call that
// actually ended while this WS somehow lived on.
func TestUnregisterClient_DoesNotClearVoicePresence(t *testing.T) {
	h := newTestHub()
	go h.Run()

	userID := uuid.New()
	channelID := uuid.New()
	client := &Client{UserID: userID, Send: make(chan []byte, 8)}

	h.RegisterClient(client)
	assert.Eventually(t, func() bool { return h.IsOnline(userID) }, time.Second, 10*time.Millisecond)

	h.JoinVoiceChannel(userID, channelID)
	h.UnregisterClient(client)

	assert.Eventually(t, func() bool { return !h.IsOnline(userID) }, time.Second, 10*time.Millisecond,
		"the client must actually be gone from the online-clients map")

	state := h.GetVoiceState()
	assert.ElementsMatch(t, []uuid.UUID{userID}, state[channelID],
		"voice presence must survive an app-WS disconnect")
}

func TestBroadcastUserUpdate_SendsToAllClients(t *testing.T) {
	h := newTestHub()
	go h.Run()

	userA := uuid.New()
	userB := uuid.New()
	clientA := &Client{UserID: userA, Send: make(chan []byte, 8)}
	clientB := &Client{UserID: userB, Send: make(chan []byte, 8)}
	h.RegisterClient(clientA)
	h.RegisterClient(clientB)
	assert.Eventually(t, func() bool { return h.IsOnline(userA) && h.IsOnline(userB) },
		time.Second, 10*time.Millisecond)

	url := "/uploads/avatars/x.jpg"
	h.BroadcastUserUpdate(userA, &url)

	deadline := time.After(time.Second)
	for {
		select {
		case msg := <-clientB.Send:
			if strings.Contains(string(msg), `"user_updated"`) && strings.Contains(string(msg), url) {
				return
			}
		case <-deadline:
			t.Fatal("client B did not receive a user_updated broadcast")
		}
	}
}

func TestBroadcastUserUpdate_NilAvatarMarshalsToNull(t *testing.T) {
	h := newTestHub()
	go h.Run()

	userA := uuid.New()
	clientA := &Client{UserID: userA, Send: make(chan []byte, 8)}
	h.RegisterClient(clientA)
	assert.Eventually(t, func() bool { return h.IsOnline(userA) }, time.Second, 10*time.Millisecond)

	h.BroadcastUserUpdate(userA, nil)

	deadline := time.After(time.Second)
	for {
		select {
		case msg := <-clientA.Send:
			if strings.Contains(string(msg), `"user_updated"`) {
				assert.Contains(t, string(msg), `"avatar_url":null`)
				return
			}
		case <-deadline:
			t.Fatal("client did not receive a user_updated broadcast")
		}
	}
}

// TestUnregisterStaleClientKeepsNewConnection: when a user reconnects, the new
// connection replaces the old one in the map. The old connection's readPump
// exits up to pongWait later and unregisters — that must NOT remove the NEW
// client from the hub or kick the user out of their voice channel.
func TestUnregisterStaleClientKeepsNewConnection(t *testing.T) {
	h := newTestHub()
	go h.Run()

	userID := uuid.New()
	channelID := uuid.New()
	oldClient := &Client{UserID: userID, Send: make(chan []byte, 512)}
	newClient := &Client{UserID: userID, Send: make(chan []byte, 512)}

	h.RegisterClient(oldClient)
	h.RegisterClient(newClient) // reconnect: replaces oldClient
	h.JoinVoiceChannel(userID, channelID)

	h.UnregisterClient(oldClient) // stale connection finally dies

	// Run processes ops sequentially; poll until the unregister settles.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if h.IsOnline(userID) {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}

	assert.True(t, h.IsOnline(userID), "user must stay online: only the stale connection died")
	state := h.GetVoiceState()
	assert.Contains(t, state, channelID, "user must stay in the voice channel")

	// The stale client's send channel must be closed so its writePump exits.
	// Drain buffered messages (online_users, voice_state, …) until close.
	timeout := time.After(time.Second)
	for {
		select {
		case _, open := <-oldClient.Send:
			if !open {
				return // closed — writePump would exit
			}
		case <-timeout:
			t.Fatal("stale client's Send was never closed")
		}
	}
}

// TestHubConcurrentBroadcastAndChurnNoRace hammers broadcast (which evicts
// slow clients) concurrently with register/unregister and SendToUser. Run with
// -race: the old implementation deleted from h.clients under RLock inside the
// broadcast fan-out.
func TestHubConcurrentBroadcastAndChurnNoRace(t *testing.T) {
	h := newTestHub()
	h.SetCallSessionRecorder(&fakeCallRecorder{})
	go h.Run()

	stop := make(chan struct{})
	var wg sync.WaitGroup

	// Churn: clients with tiny buffers so broadcasts hit the slow-client path.
	for g := 0; g < 4; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				c := &Client{UserID: uuid.New(), Send: make(chan []byte, 1)}
				h.RegisterClient(c)
				h.SendToUser(c.UserID, &Message{Type: "ping"})
				h.UnregisterClient(c)
			}
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
			}
			h.BroadcastMessage(&Message{Type: "noise"})
		}
	}()

	time.Sleep(300 * time.Millisecond)
	close(stop)
	wg.Wait()
}

func TestSendToUsers_DeliversOnlyToListedClients(t *testing.T) {
	h := newTestHub()
	go h.Run()

	targetID := uuid.New()
	otherID := uuid.New()
	target := &Client{UserID: targetID, Send: make(chan []byte, 8)}
	other := &Client{UserID: otherID, Send: make(chan []byte, 8)}
	h.RegisterClient(target)
	h.RegisterClient(other)
	assert.Eventually(t, func() bool { return h.IsOnline(targetID) && h.IsOnline(otherID) },
		time.Second, 10*time.Millisecond)

	h.SendToUsers([]uuid.UUID{targetID}, &Message{Type: "voice_participants", Payload: []byte(`{}`)})

	deadline := time.After(time.Second)
waitForTarget:
	for {
		select {
		case msg := <-target.Send:
			if strings.Contains(string(msg), `"voice_participants"`) {
				break waitForTarget
			}
		case <-deadline:
			t.Fatal("targeted client did not receive the message")
		}
	}

	select {
	case msg := <-other.Send:
		if strings.Contains(string(msg), `"voice_participants"`) {
			t.Fatalf("non-targeted client received the message: %s", msg)
		}
	case <-time.After(200 * time.Millisecond):
	}
}

func TestBroadcastVoiceParticipants_UsesResolverToRestrictAudience(t *testing.T) {
	h := newTestHub()
	go h.Run()

	channelID := uuid.New()
	targetID := uuid.New()
	otherID := uuid.New()
	target := &Client{UserID: targetID, Send: make(chan []byte, 8)}
	other := &Client{UserID: otherID, Send: make(chan []byte, 8)}
	h.RegisterClient(target)
	h.RegisterClient(other)
	assert.Eventually(t, func() bool { return h.IsOnline(targetID) && h.IsOnline(otherID) },
		time.Second, 10*time.Millisecond)

	h.SetVoiceAudienceResolver(func(cID uuid.UUID) ([]uuid.UUID, error) {
		assert.Equal(t, channelID, cID)
		return []uuid.UUID{targetID}, nil
	})

	h.BroadcastVoiceParticipants(channelID, []uuid.UUID{targetID})

	deadline := time.After(time.Second)
waitForTarget2:
	for {
		select {
		case msg := <-target.Send:
			if strings.Contains(string(msg), `"voice_participants"`) {
				break waitForTarget2
			}
		case <-deadline:
			t.Fatal("targeted client did not receive voice_participants")
		}
	}

	select {
	case msg := <-other.Send:
		if strings.Contains(string(msg), `"voice_participants"`) {
			t.Fatalf("non-audience client received voice_participants: %s", msg)
		}
	case <-time.After(200 * time.Millisecond):
	}
}

func TestBroadcastVoiceParticipants_NilResolverBroadcastsToAll(t *testing.T) {
	h := newTestHub()
	go h.Run()

	channelID := uuid.New()
	userA := uuid.New()
	clientA := &Client{UserID: userA, Send: make(chan []byte, 8)}
	h.RegisterClient(clientA)
	assert.Eventually(t, func() bool { return h.IsOnline(userA) }, time.Second, 10*time.Millisecond)

	h.BroadcastVoiceParticipants(channelID, []uuid.UUID{userA})

	deadline := time.After(time.Second)
	for {
		select {
		case msg := <-clientA.Send:
			if strings.Contains(string(msg), `"voice_participants"`) {
				return
			}
		case <-deadline:
			t.Fatal("client did not receive voice_participants broadcast")
		}
	}
}

func TestBroadcastVoiceParticipants_ResolverError_FailsClosed(t *testing.T) {
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

	h.SetVoiceAudienceResolver(func(cID uuid.UUID) ([]uuid.UUID, error) {
		return nil, errors.New("resolver boom")
	})

	h.BroadcastVoiceParticipants(channelID, []uuid.UUID{userA})

	select {
	case msg := <-clientA.Send:
		if strings.Contains(string(msg), `"voice_participants"`) {
			t.Fatalf("client A received voice_participants despite resolver error: %s", msg)
		}
	case <-time.After(200 * time.Millisecond):
	}

	select {
	case msg := <-clientB.Send:
		if strings.Contains(string(msg), `"voice_participants"`) {
			t.Fatalf("client B received voice_participants despite resolver error: %s", msg)
		}
	case <-time.After(200 * time.Millisecond):
	}
}

// --- VYC-78 step 4: ReconcileVoicePresence ---

// TestReconcileVoicePresence_AddsMissingParticipant covers the case
// reconciliation exists for: a channel the SFU says has someone in it, that the
// hub's own client-driven voice_joined bookkeeping never recorded (a missed
// event, or a grace-session resume that never re-announced).
func TestReconcileVoicePresence_AddsMissingParticipant(t *testing.T) {
	h := newTestHub()
	channelID := uuid.New()
	userID := uuid.New()

	changed := h.ReconcileVoicePresence(map[uuid.UUID][]uuid.UUID{channelID: {userID}})

	assert.Equal(t, []uuid.UUID{channelID}, changed)
	assert.ElementsMatch(t, []uuid.UUID{userID}, h.GetVoiceState()[channelID])
}

// TestReconcileVoicePresence_RemovesGhostParticipant covers the reverse: the
// hub believes someone is in a channel the SFU no longer reports them in at
// all (their call ended some other way — e.g. they never sent voice_left).
func TestReconcileVoicePresence_RemovesGhostParticipant(t *testing.T) {
	h := newTestHub()
	channelID := uuid.New()
	userID := uuid.New()
	h.JoinVoiceChannel(userID, channelID)

	changed := h.ReconcileVoicePresence(map[uuid.UUID][]uuid.UUID{})

	assert.Equal(t, []uuid.UUID{channelID}, changed)
	_, stillThere := h.GetVoiceState()[channelID]
	assert.False(t, stillThere, "channel the SFU no longer reports must be cleared")
}

// TestReconcileVoicePresence_LeavesMatchingChannelsUnreported: the caller uses
// the returned list to decide which channels to broadcast for. A channel that
// already matches must not be reported as changed — the whole point is to
// broadcast only what actually needs correcting, not resend everything on
// every tick.
func TestReconcileVoicePresence_LeavesMatchingChannelsUnreported(t *testing.T) {
	h := newTestHub()
	channelID := uuid.New()
	userID := uuid.New()
	h.JoinVoiceChannel(userID, channelID)

	changed := h.ReconcileVoicePresence(map[uuid.UUID][]uuid.UUID{channelID: {userID}})

	assert.Empty(t, changed, "a channel that already matches the SFU's snapshot must not be reported as changed")
}

// TestReconcileVoicePresence_PopulatesClientVoiceChannelIndex proves
// reconciliation keeps the derived clientVoiceChannel index consistent, not
// just the public voiceChannels map: LeaveVoiceChannel depends on it to know
// which channel a user is in, and a user added purely by reconciliation (who
// never went through JoinVoiceChannel — e.g. their voice_joined was missed but
// the SFU always knew they were there) must still be leavable correctly.
func TestReconcileVoicePresence_PopulatesClientVoiceChannelIndex(t *testing.T) {
	h := newTestHub()
	channelID := uuid.New()
	userID := uuid.New()

	h.ReconcileVoicePresence(map[uuid.UUID][]uuid.UUID{channelID: {userID}})

	gotChannelID, participants, ok := h.LeaveVoiceChannel(userID)
	assert.True(t, ok, "a user added purely by reconciliation must still be leavable")
	assert.Equal(t, channelID, gotChannelID)
	assert.Empty(t, participants)
}

// --- VYC-87: CallSessionRecorder wiring ---

type callStartedCall struct {
	channelID uuid.UUID
	starterID uuid.UUID
}

// fakeCallRecorder is a hand-rolled CallSessionRecorder double — no
// testify/mock here (server CLAUDE.md: golangci-lint's typecheck can't
// resolve mock.Mock in this toolchain, and this file must not become a new
// red one).
type fakeCallRecorder struct {
	mu      sync.Mutex
	started []callStartedCall
	ended   []uuid.UUID
	// onCall, when set, runs synchronously inside CallStarted/CallEnded —
	// used by the lock-discipline test below to call back into the hub.
	onCall func()
}

func (f *fakeCallRecorder) CallStarted(channelID, starterID uuid.UUID) {
	f.mu.Lock()
	f.started = append(f.started, callStartedCall{channelID, starterID})
	f.mu.Unlock()
	if f.onCall != nil {
		f.onCall()
	}
}

func (f *fakeCallRecorder) CallEnded(channelID uuid.UUID) {
	f.mu.Lock()
	f.ended = append(f.ended, channelID)
	f.mu.Unlock()
	if f.onCall != nil {
		f.onCall()
	}
}

func TestJoinVoiceChannel_FirstJoinCallsCallStarted(t *testing.T) {
	h := newTestHub()
	rec := &fakeCallRecorder{}
	h.SetCallSessionRecorder(rec)
	userID, channelID := uuid.New(), uuid.New()

	h.JoinVoiceChannel(userID, channelID)

	rec.mu.Lock()
	defer rec.mu.Unlock()
	assert.Equal(t, []callStartedCall{{channelID, userID}}, rec.started)
}

func TestJoinVoiceChannel_SecondJoinDoesNotCallCallStarted(t *testing.T) {
	h := newTestHub()
	rec := &fakeCallRecorder{}
	h.SetCallSessionRecorder(rec)
	channelID := uuid.New()

	h.JoinVoiceChannel(uuid.New(), channelID)
	h.JoinVoiceChannel(uuid.New(), channelID)

	rec.mu.Lock()
	defer rec.mu.Unlock()
	assert.Len(t, rec.started, 1, "only the join that found an empty channel must call CallStarted")
}

func TestLeaveVoiceChannel_LastLeaveCallsCallEnded(t *testing.T) {
	h := newTestHub()
	rec := &fakeCallRecorder{}
	h.SetCallSessionRecorder(rec)
	userID, channelID := uuid.New(), uuid.New()
	h.JoinVoiceChannel(userID, channelID)

	h.LeaveVoiceChannel(userID)

	rec.mu.Lock()
	defer rec.mu.Unlock()
	assert.Equal(t, []uuid.UUID{channelID}, rec.ended)
}

func TestLeaveVoiceChannel_NonLastLeaveDoesNotCallCallEnded(t *testing.T) {
	h := newTestHub()
	rec := &fakeCallRecorder{}
	h.SetCallSessionRecorder(rec)
	channelID := uuid.New()
	userA, userB := uuid.New(), uuid.New()
	h.JoinVoiceChannel(userA, channelID)
	h.JoinVoiceChannel(userB, channelID)

	h.LeaveVoiceChannel(userA)

	rec.mu.Lock()
	defer rec.mu.Unlock()
	assert.Empty(t, rec.ended)
}

func TestReconcileVoicePresence_NewChannelCallsCallStartedWithFirstParticipant(t *testing.T) {
	h := newTestHub()
	rec := &fakeCallRecorder{}
	h.SetCallSessionRecorder(rec)
	channelID, userID := uuid.New(), uuid.New()

	h.ReconcileVoicePresence(map[uuid.UUID][]uuid.UUID{channelID: {userID}})

	rec.mu.Lock()
	defer rec.mu.Unlock()
	assert.Equal(t, []callStartedCall{{channelID, userID}}, rec.started)
}

func TestReconcileVoicePresence_DisappearedChannelCallsCallEnded(t *testing.T) {
	h := newTestHub()
	rec := &fakeCallRecorder{}
	h.SetCallSessionRecorder(rec)
	channelID := uuid.New()
	h.JoinVoiceChannel(uuid.New(), channelID)

	h.ReconcileVoicePresence(map[uuid.UUID][]uuid.UUID{})

	rec.mu.Lock()
	defer rec.mu.Unlock()
	assert.Equal(t, []uuid.UUID{channelID}, rec.ended)
}

// TestReconcileVoicePresence_RosterChurnOnExistingChannelDoesNotCallRecorder:
// a channel that already existed and merely gained/lost OTHER participants
// must not re-fire CallStarted — it's the same call, still going.
func TestReconcileVoicePresence_RosterChurnOnExistingChannelDoesNotCallRecorder(t *testing.T) {
	h := newTestHub()
	rec := &fakeCallRecorder{}
	h.SetCallSessionRecorder(rec)
	channelID, userA := uuid.New(), uuid.New()
	h.JoinVoiceChannel(userA, channelID)
	// JoinVoiceChannel above is itself a legitimate empty→non-empty
	// transition and correctly fires CallStarted; reset the recorder so the
	// assertions below isolate what ReconcileVoicePresence does with an
	// already-existing channel, not this setup call.
	rec.mu.Lock()
	rec.started = nil
	rec.ended = nil
	rec.mu.Unlock()

	h.ReconcileVoicePresence(map[uuid.UUID][]uuid.UUID{channelID: {userA, uuid.New()}})

	rec.mu.Lock()
	defer rec.mu.Unlock()
	assert.Empty(t, rec.started)
	assert.Empty(t, rec.ended)
}

func TestJoinLeaveVoiceChannel_NilRecorderIsSafe(t *testing.T) {
	h := newTestHub()
	userID, channelID := uuid.New(), uuid.New()

	assert.NotPanics(t, func() {
		h.JoinVoiceChannel(userID, channelID)
		h.LeaveVoiceChannel(userID)
	})
}

// TestCallSessionRecorder_CanCallBackIntoHubWithoutDeadlock is the lock-
// discipline test the design doc calls for: CallStarted/CallEnded must run
// with h.mu released, or a recorder that calls back into the hub — exactly
// what the real usecase-layer recorder does, via hub.SendToChannel —
// deadlocks the hub goroutine forever.
func TestCallSessionRecorder_CanCallBackIntoHubWithoutDeadlock(t *testing.T) {
	h := newTestHub()
	userID, channelID := uuid.New(), uuid.New()
	rec := &fakeCallRecorder{}
	rec.onCall = func() { h.GetVoiceState() }
	h.SetCallSessionRecorder(rec)

	done := make(chan struct{})
	go func() {
		h.JoinVoiceChannel(userID, channelID)
		h.LeaveVoiceChannel(userID)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("JoinVoiceChannel/LeaveVoiceChannel deadlocked: recorder callback must run with h.mu released")
	}
}
