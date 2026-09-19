// Package guestws holds the guest WebSocket gateway: the only realtime channel
// a call guest has. It is deliberately NOT ws.Hub — a guest is keyed by
// guest_id, belongs to exactly one channel, and can therefore never be reached
// by the hub's global broadcasts (which today carry every call's mic and
// screen-share events). See
// docs/superpowers/specs/2026-09-17-guest-call-link-design.md, section «WS».
package guestws

import (
	"encoding/json"
	"log/slog"
	"sync"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type Message struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// Marshal builds a message; a payload that cannot be encoded becomes an empty
// one rather than a panic in a fan-out path.
func Marshal(msgType string, payload any) *Message {
	m := &Message{Type: msgType}
	if payload == nil {
		return m
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return m
	}
	m.Payload = raw
	return m
}

type Client struct {
	GuestID   uuid.UUID
	ChannelID uuid.UUID
	Conn      *websocket.Conn
	Send      chan []byte
}

type Gateway struct {
	mu        sync.Mutex
	clients   map[uuid.UUID]*Client
	byChannel map[uuid.UUID]map[uuid.UUID]struct{}
	log       *slog.Logger
}

func NewGateway(log *slog.Logger) *Gateway {
	return &Gateway{
		clients:   make(map[uuid.UUID]*Client),
		byChannel: make(map[uuid.UUID]map[uuid.UUID]struct{}),
		log:       log,
	}
}

// Register makes c the guest's current connection, ending the previous one.
// A guest reconnecting after a network blip must not leave a half-open socket
// behind that still counts as "present" for the absence worker.
func (g *Gateway) Register(c *Client) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if old, ok := g.clients[c.GuestID]; ok && old != c {
		g.removeLocked(old)
		close(old.Send)
	}
	g.clients[c.GuestID] = c
	if g.byChannel[c.ChannelID] == nil {
		g.byChannel[c.ChannelID] = make(map[uuid.UUID]struct{})
	}
	g.byChannel[c.ChannelID][c.GuestID] = struct{}{}
}

// Unregister removes c if it is still the current connection. A stale client
// dying late must not disconnect the live one that replaced it.
func (g *Gateway) Unregister(c *Client) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if cur, ok := g.clients[c.GuestID]; ok && cur == c {
		g.removeLocked(c)
		close(c.Send)
	}
}

func (g *Gateway) IsCurrent(c *Client) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	cur, ok := g.clients[c.GuestID]
	return ok && cur == c
}

// Connected returns guest → channel for every live connection.
func (g *Gateway) Connected() map[uuid.UUID]uuid.UUID {
	g.mu.Lock()
	defer g.mu.Unlock()
	out := make(map[uuid.UUID]uuid.UUID, len(g.clients))
	for id, c := range g.clients {
		out[id] = c.ChannelID
	}
	return out
}

func (g *Gateway) Send(guestID uuid.UUID, msg *Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	if c, ok := g.clients[guestID]; ok {
		g.deliverLocked(c, data)
	}
}

func (g *Gateway) Broadcast(channelID uuid.UUID, msg *Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	for guestID := range g.byChannel[channelID] {
		if c, ok := g.clients[guestID]; ok {
			g.deliverLocked(c, data)
		}
	}
}

// CloseGuest delivers a final message and ends the connection — the guest
// learns WHY they are gone before the socket closes.
func (g *Gateway) CloseGuest(guestID uuid.UUID, msg *Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		data = nil
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	c, ok := g.clients[guestID]
	if !ok {
		return
	}
	if data != nil {
		select {
		case c.Send <- data:
		default:
		}
	}
	g.removeLocked(c)
	close(c.Send)
}

// deliverLocked never blocks: a guest that cannot keep up is dropped, exactly
// like the hub drops a slow client, so one stuck socket cannot stall a fan-out.
func (g *Gateway) deliverLocked(c *Client, data []byte) {
	select {
	case c.Send <- data:
	default:
		g.log.Warn("guest gateway: send channel full, dropping connection", "guest_id", c.GuestID)
		g.removeLocked(c)
		close(c.Send)
	}
}

// removeLocked unregisters a client WITHOUT touching its socket. Closing the
// connection here would kill the writer before it flushed whatever was just
// queued — and the last thing queued is exactly the message the guest needs
// («вас выгнали», «звонок завершён»). Closing c.Send is enough: writePump
// sends the WebSocket close frame and closes the connection itself.
func (g *Gateway) removeLocked(c *Client) {
	delete(g.clients, c.GuestID)
	if guests, ok := g.byChannel[c.ChannelID]; ok {
		delete(guests, c.GuestID)
		if len(guests) == 0 {
			delete(g.byChannel, c.ChannelID)
		}
	}
}
