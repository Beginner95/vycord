package guestws

import (
	"encoding/json"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestGateway() *Gateway { return NewGateway(slog.New(slog.NewTextHandler(io.Discard, nil))) }

func newTestClient(guestID, channelID uuid.UUID) *Client {
	return &Client{GuestID: guestID, ChannelID: channelID, Send: make(chan []byte, 8)}
}

func readType(t *testing.T, c *Client) string {
	t.Helper()
	select {
	case raw, ok := <-c.Send:
		require.True(t, ok, "channel closed instead of delivering a message")
		var m Message
		require.NoError(t, json.Unmarshal(raw, &m))
		return m.Type
	default:
		t.Fatal("expected a message")
		return ""
	}
}

func TestGatewaySendAndBroadcast(t *testing.T) {
	g := newTestGateway()
	channelID, other := uuid.New(), uuid.New()
	a := newTestClient(uuid.New(), channelID)
	b := newTestClient(uuid.New(), channelID)
	elsewhere := newTestClient(uuid.New(), other)
	g.Register(a)
	g.Register(b)
	g.Register(elsewhere)

	g.Send(a.GuestID, Marshal("admitted", map[string]string{"room_id": channelID.String()}))
	assert.Equal(t, "admitted", readType(t, a))
	assert.Empty(t, b.Send)

	g.Broadcast(channelID, Marshal("participants", nil))
	assert.Equal(t, "participants", readType(t, a))
	assert.Equal(t, "participants", readType(t, b))
	assert.Empty(t, elsewhere.Send, "a guest of another channel hears nothing")

	g.Send(uuid.New(), Marshal("admitted", nil)) // unknown guest: no panic
}

func TestGatewayRegisterEvictsPreviousConnection(t *testing.T) {
	g := newTestGateway()
	guestID, channelID := uuid.New(), uuid.New()
	first := newTestClient(guestID, channelID)
	second := newTestClient(guestID, channelID)

	g.Register(first)
	g.Register(second)

	_, open := <-first.Send
	assert.False(t, open, "the replaced connection is closed")
	assert.True(t, g.IsCurrent(second))
	assert.False(t, g.IsCurrent(first))

	g.Unregister(first) // stale client must not unregister the live one
	assert.True(t, g.IsCurrent(second))

	g.Send(guestID, Marshal("participants", nil))
	assert.Equal(t, "participants", readType(t, second))
}

func TestGatewayCloseGuest(t *testing.T) {
	g := newTestGateway()
	c := newTestClient(uuid.New(), uuid.New())
	g.Register(c)

	g.CloseGuest(c.GuestID, Marshal("kicked", map[string]string{"reason": "kicked"}))
	assert.Equal(t, "kicked", readType(t, c), "the reason is delivered before the socket dies")
	_, open := <-c.Send
	assert.False(t, open)
	assert.False(t, g.IsCurrent(c))

	g.CloseGuest(uuid.New(), Marshal("kicked", nil)) // unknown guest: no panic
}

func TestGatewayConnected(t *testing.T) {
	g := newTestGateway()
	channelID := uuid.New()
	a := newTestClient(uuid.New(), channelID)
	g.Register(a)

	assert.Equal(t, map[uuid.UUID]uuid.UUID{a.GuestID: channelID}, g.Connected())

	g.Unregister(a)
	assert.Empty(t, g.Connected())
	g.Broadcast(channelID, Marshal("participants", nil)) // no listeners: must not panic
}

func TestGatewayDropsSlowClient(t *testing.T) {
	g := newTestGateway()
	c := &Client{GuestID: uuid.New(), ChannelID: uuid.New(), Send: make(chan []byte)} // unbuffered: never ready
	g.Register(c)

	g.Send(c.GuestID, Marshal("participants", nil))
	assert.False(t, g.IsCurrent(c), "a guest that cannot keep up is disconnected, never blocks the sender")
}
