package ws

import (
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
