package guestevents

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/delivery/guestws"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/authtoken"
)

type fakeHub struct {
	mu       sync.Mutex
	sent     []sentToUsers
	roster   map[uuid.UUID][]uuid.UUID
	channels map[uuid.UUID]uuid.UUID
}

type sentToUsers struct {
	users []uuid.UUID
	msg   *ws.Message
}

func newFakeHub() *fakeHub {
	return &fakeHub{roster: map[uuid.UUID][]uuid.UUID{}, channels: map[uuid.UUID]uuid.UUID{}}
}

func (f *fakeHub) SendToUsers(userIDs []uuid.UUID, message *ws.Message) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, sentToUsers{users: userIDs, msg: message})
}
func (f *fakeHub) VoiceParticipants(channelID uuid.UUID) []uuid.UUID { return f.roster[channelID] }
func (f *fakeHub) VoiceChannelOf(userID uuid.UUID) (uuid.UUID, bool) {
	ch, ok := f.channels[userID]
	return ch, ok
}
func (f *fakeHub) types() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, 0, len(f.sent))
	for _, s := range f.sent {
		out = append(out, s.msg.Type)
	}
	return out
}

type fakeGateway struct {
	mu        sync.Mutex
	sent      map[uuid.UUID][]string
	broadcast map[uuid.UUID][]string
	closed    map[uuid.UUID]string
	connected map[uuid.UUID]uuid.UUID
}

func newFakeGateway() *fakeGateway {
	return &fakeGateway{
		sent: map[uuid.UUID][]string{}, broadcast: map[uuid.UUID][]string{},
		closed: map[uuid.UUID]string{}, connected: map[uuid.UUID]uuid.UUID{},
	}
}

func (f *fakeGateway) Send(guestID uuid.UUID, msg *guestws.Message) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent[guestID] = append(f.sent[guestID], msg.Type)
}
func (f *fakeGateway) Broadcast(channelID uuid.UUID, msg *guestws.Message) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.broadcast[channelID] = append(f.broadcast[channelID], msg.Type)
}
func (f *fakeGateway) CloseGuest(guestID uuid.UUID, msg *guestws.Message) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var payload struct {
		Reason string `json:"reason"`
	}
	_ = json.Unmarshal(msg.Payload, &payload)
	f.closed[guestID] = msg.Type + ":" + payload.Reason
}
func (f *fakeGateway) Connected() map[uuid.UUID]uuid.UUID { return f.connected }

type fakeSFU struct {
	mu     sync.Mutex
	kicked map[string]uuid.UUID
}

func newFakeSFU() *fakeSFU { return &fakeSFU{kicked: map[string]uuid.UUID{}} }

func (f *fakeSFU) KickGuest(_ context.Context, roomID uuid.UUID, identity string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.kicked[identity] = roomID
	return nil
}
func (f *fakeSFU) wasKicked(identity string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.kicked[identity]
	return ok
}

type fakeLister struct {
	callID uuid.UUID
	state  *domain.GuestCallState
}

func (f *fakeLister) OpenCallMessageID(uuid.UUID) (uuid.UUID, error) { return f.callID, nil }
func (f *fakeLister) ListCallState(uuid.UUID) (*domain.GuestCallState, error) {
	return f.state, nil
}

type fakeUsers struct{ names map[uuid.UUID]string }

func (f *fakeUsers) GetByID(id uuid.UUID) (*domain.User, error) {
	return &domain.User{ID: id, Username: f.names[id]}, nil
}

type fixture struct {
	hub     *fakeHub
	gw      *fakeGateway
	sfu     *fakeSFU
	lister  *fakeLister
	events  *Events
	channel uuid.UUID
	member  uuid.UUID
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{
		hub: newFakeHub(), gw: newFakeGateway(), sfu: newFakeSFU(),
		channel: uuid.New(), member: uuid.New(),
	}
	f.lister = &fakeLister{callID: uuid.New(), state: &domain.GuestCallState{}}
	f.hub.roster[f.channel] = []uuid.UUID{f.member}
	f.hub.channels[f.member] = f.channel
	f.events = New(f.hub, f.gw, f.sfu, f.lister, &fakeUsers{names: map[uuid.UUID]string{f.member: "вася"}},
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	return f
}

func guest(channelID uuid.UUID, status domain.GuestStatus, admitted bool) *domain.CallGuest {
	g := &domain.CallGuest{ID: uuid.New(), ChannelID: channelID, DisplayName: "Гость", Status: status}
	if admitted {
		now := time.Now()
		g.AdmittedAt = &now
	}
	return g
}

func TestLobbyRequestedReachesMembersAndGuest(t *testing.T) {
	f := newFixture(t)
	g := guest(f.channel, domain.GuestStatusLobby, false)

	f.events.LobbyRequested(g, &f.member)

	require.Len(t, f.hub.sent, 1)
	assert.Equal(t, "guest_lobby_request", f.hub.sent[0].msg.Type)
	assert.Equal(t, []uuid.UUID{f.member}, f.hub.sent[0].users, "only the call's participants are told")
	assert.Equal(t, []string{"lobby_waiting"}, f.gw.sent[g.ID])
}

func TestLobbyResolvedAdmitSendsRoster(t *testing.T) {
	f := newFixture(t)
	g := guest(f.channel, domain.GuestStatusAdmitted, true)

	f.events.LobbyResolved(g, &f.member)

	assert.Contains(t, f.hub.types(), "guest_lobby_resolved")
	assert.Equal(t, []string{"admitted", "participants"}, f.gw.sent[g.ID])
}

func TestGuestsEndedClosesGatewayAndKicksSFU(t *testing.T) {
	f := newFixture(t)
	admitted := guest(f.channel, domain.GuestStatusKicked, true)
	waiting := guest(f.channel, domain.GuestStatusRejected, false)

	f.events.GuestsEnded([]*domain.CallGuest{admitted, waiting})

	assert.Equal(t, "kicked:kicked", f.gw.closed[admitted.ID])
	assert.Equal(t, "rejected:", f.gw.closed[waiting.ID])
	// Кик в SFU уходит в фоне: ответ API не должен ждать сетевого вызова.
	assert.Eventually(t, func() bool { return f.sfu.wasKicked(authtoken.GuestIdentity(admitted.ID)) },
		2*time.Second, 5*time.Millisecond)
	assert.False(t, f.sfu.wasKicked(authtoken.GuestIdentity(waiting.ID)),
		"a guest who never got into the call is not in the SFU")
	assert.Contains(t, f.hub.types(), "guest_participants")
}

func TestGuestsEndedReasons(t *testing.T) {
	cases := map[domain.GuestStatus]string{
		domain.GuestStatusKicked:       "kicked:kicked",
		domain.GuestStatusRevoked:      "kicked:link_revoked",
		domain.GuestStatusCallEnded:    "call_ended:",
		domain.GuestStatusRejected:     "rejected:",
		domain.GuestStatusLobbyTimeout: "lobby_timeout:",
		domain.GuestStatusLeft:         "",
	}
	for status, want := range cases {
		f := newFixture(t)
		g := guest(f.channel, status, false)
		f.events.GuestsEnded([]*domain.CallGuest{g})
		assert.Equal(t, want, f.gw.closed[g.ID], "status %s", status)
	}
}

// У12: a member's mic event reaches the guests of THAT call and nobody else.
func TestMirrorFromUser(t *testing.T) {
	f := newFixture(t)
	f.events.MirrorFromUser(f.member, "mic_muted", nil)
	assert.Equal(t, []string{"mic_muted"}, f.gw.broadcast[f.channel])

	stranger := uuid.New()
	f.events.MirrorFromUser(stranger, "mic_muted", nil)
	assert.Len(t, f.gw.broadcast[f.channel], 1, "a member who is in no call mirrors nothing")
}

func TestRelayGuestSignalStampsIdentity(t *testing.T) {
	f := newFixture(t)
	gc := &domain.GuestContext{Guest: *guest(f.channel, domain.GuestStatusAdmitted, true)}

	f.events.RelayGuestSignal(gc, "mic_muted", json.RawMessage(`{"user_id":"impostor"}`))

	require.Len(t, f.hub.sent, 1)
	assert.Equal(t, "mic_muted", f.hub.sent[0].msg.Type)
	var payload map[string]any
	require.NoError(t, json.Unmarshal(f.hub.sent[0].msg.Payload, &payload))
	assert.Equal(t, authtoken.GuestIdentity(gc.Guest.ID), payload["user_id"],
		"the identity comes from the session, never from the payload")
}

func TestChatMessageAndDeletionReachGuests(t *testing.T) {
	f := newFixture(t)
	userID := f.member
	msg := &domain.Message{ID: uuid.New(), ChannelID: f.channel, UserID: &userID, Content: "привет"}

	f.events.ChatMessage(f.channel, msg, &domain.User{ID: userID, Username: "вася"})
	assert.Equal(t, []string{"chat_message"}, f.gw.broadcast[f.channel])

	f.events.MessageDeleted(f.channel, msg.ID)
	assert.Equal(t, []string{"chat_message", "message_delete"}, f.gw.broadcast[f.channel])
}

func TestVoiceParticipantsChangedRefreshesGuestRoster(t *testing.T) {
	f := newFixture(t)
	f.gw.connected[uuid.New()] = f.channel

	f.events.VoiceParticipantsChanged(f.channel)

	assert.Equal(t, []string{"participants"}, f.gw.broadcast[f.channel],
		"guests learn about members joining and leaving the call")
}

func TestVoiceParticipantsChangedSkipsChannelsWithoutGuests(t *testing.T) {
	f := newFixture(t)
	f.gw.connected[uuid.New()] = uuid.New() // гость есть, но в другом звонке

	f.events.VoiceParticipantsChanged(f.channel)

	assert.Empty(t, f.gw.broadcast[f.channel])
}
