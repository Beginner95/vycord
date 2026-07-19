package ws

import (
	"sync"
	"io"
	"log/slog"
	"strings"
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
