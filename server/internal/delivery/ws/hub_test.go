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
